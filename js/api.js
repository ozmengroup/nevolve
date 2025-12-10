// nevolve.ai API Module
const API = {
    // Basit önbellek sistemi
    _cache: new Map(),
    _cacheTimeout: 5 * 60 * 1000, // 5 dakika

    // Rate limit durumu
    _rateLimitUntil: 0,

    // Önbellekten al veya kaydet
    _getCache(key) {
        const cached = this._cache.get(key);
        if (cached && Date.now() < cached.expires) {
            return cached.data;
        }
        this._cache.delete(key);
        return null;
    },

    _setCache(key, data) {
        this._cache.set(key, {
            data,
            expires: Date.now() + this._cacheTimeout
        });
    },

    // Rate limit hatası mı kontrol et
    _isRateLimitError(error) {
        return error && (
            error.includes('quota') ||
            error.includes('rate') ||
            error.includes('limit') ||
            error.includes('429')
        );
    },

    // Kullanıcı dostu hata mesajı
    _formatError(error) {
        if (this._isRateLimitError(error)) {
            const waitTime = Math.ceil((this._rateLimitUntil - Date.now()) / 1000);
            return {
                type: 'rate_limit',
                message: 'Çok fazla istek gönderildi.',
                detail: waitTime > 0
                    ? `Lütfen ${waitTime} saniye bekleyin.`
                    : 'Lütfen 30 saniye bekleyip tekrar deneyin.',
                retryAfter: waitTime > 0 ? waitTime : 30
            };
        }
        if (error.includes('network') || error.includes('fetch')) {
            return {
                type: 'network',
                message: 'Bağlantı hatası.',
                detail: 'İnternet bağlantınızı kontrol edin.',
                retryAfter: 5
            };
        }
        return {
            type: 'unknown',
            message: 'Bir hata oluştu.',
            detail: error,
            retryAfter: 10
        };
    },

    // Conversation history
    _conversationHistory: [],

    // Conversation'ı sıfırla
    resetConversation() {
        this._conversationHistory = [];
    },

    // Streaming ile AI'a sor
    async askAIStream(question, onChunk) {
        // Rate limit kontrolü
        if (Date.now() < this._rateLimitUntil) {
            const waitTime = Math.ceil((this._rateLimitUntil - Date.now()) / 1000);
            return {
                success: false,
                error: this._formatError('rate limit'),
                retryAfter: waitTime
            };
        }

        try {
            // Conversation history'e ekle
            this._conversationHistory.push({ role: 'user', content: question });

            const messages = [
                { role: 'system', content: CONFIG.AI_SYSTEM_PROMPT },
                ...this._conversationHistory.slice(-6) // Son 6 mesaj (3 soru-cevap)
            ];

            const response = await fetch(CONFIG.WORKER_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, stream: true })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'API hatası');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                chunkCount++;

                // İlk chunk'ı logla - format kontrolü için
                if (chunkCount === 1) {
                    console.log('[API] İlk chunk (ham):', chunk.substring(0, 300));

                    // Rate limit hatası kontrolü
                    if (chunk.includes('"error"') && chunk.includes('Rate limit')) {
                        const match = chunk.match(/try again in (\d+m?\d*\.?\d*s?)/);
                        const waitTime = match ? match[1] : '10 dakika';
                        throw new Error(`API limit aşıldı. Lütfen ${waitTime} sonra tekrar deneyin.`);
                    }
                }

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                fullText += content;
                                if (onChunk) onChunk(fullText);
                            }
                        } catch (e) {
                            // JSON parse hatası, devam et
                        }
                    }
                }
            }

            console.log('[API] Stream tamamlandı. Chunk sayısı:', chunkCount, 'Text uzunluğu:', fullText.length);

            // Assistant cevabını history'e ekle
            this._conversationHistory.push({ role: 'assistant', content: fullText });

            return { success: true, text: fullText, provider: 'worker-stream' };
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // Normal (non-streaming) AI - fallback
    async askAI(question, retryCount = 0) {
        // Rate limit kontrolü
        if (Date.now() < this._rateLimitUntil) {
            const waitTime = Math.ceil((this._rateLimitUntil - Date.now()) / 1000);
            return {
                success: false,
                error: this._formatError('rate limit'),
                retryAfter: waitTime
            };
        }

        try {
            // Conversation history'e ekle
            this._conversationHistory.push({ role: 'user', content: question });

            const messages = [
                { role: 'system', content: CONFIG.AI_SYSTEM_PROMPT },
                ...this._conversationHistory.slice(-6)
            ];

            const response = await fetch(CONFIG.WORKER_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, stream: false })
            });

            const data = await response.json();

            if (data.choices?.[0]?.message?.content) {
                const text = data.choices[0].message.content;
                this._conversationHistory.push({ role: 'assistant', content: text });
                return { success: true, text, provider: 'worker' };
            }

            const errorMsg = data.error?.message || 'Bilinmeyen hata';

            if (this._isRateLimitError(errorMsg)) {
                this._rateLimitUntil = Date.now() + 10000;
                if (retryCount < 1) {
                    return {
                        success: false,
                        error: this._formatError(errorMsg),
                        willRetry: true,
                        retryAfter: 10
                    };
                }
            }

            return { success: false, error: this._formatError(errorMsg) };
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // AI ile dava tipi algılama - çok hızlı, tek satır cevap
    async detectCaseTypeAI(question) {
        const cacheKey = `casetype_${question.slice(0, 50)}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            const prompt = `Aşağıdaki hukuki soru hangi dava türü? SADECE birini yaz, başka hiçbir şey yazma:
ceza / is / icra / aile / idari / miras / ticaret / tuketici / genel

Soru: ${question.slice(0, 200)}`;

            const response = await fetch(CONFIG.WORKER_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                    max_tokens: 20,  // Çok kısa cevap
                    temperature: 0   // Deterministik
                })
            });

            const data = await response.json();
            const answer = data.choices?.[0]?.message?.content?.toLowerCase().trim() || '';

            // Cevabı parse et
            const typeMap = {
                'ceza': { type: 'ceza', label: 'Ceza Hukuku' },
                'is': { type: 'is', label: 'İş Hukuku' },
                'iş': { type: 'is', label: 'İş Hukuku' },
                'icra': { type: 'icra', label: 'İcra Hukuku' },
                'aile': { type: 'aile', label: 'Aile Hukuku' },
                'idari': { type: 'idari', label: 'İdari Hukuk' },
                'miras': { type: 'miras', label: 'Miras Hukuku' },
                'ticaret': { type: 'ticaret', label: 'Ticaret Hukuku' },
                'tuketici': { type: 'tuketici', label: 'Tüketici Hukuku' },
                'tüketici': { type: 'tuketici', label: 'Tüketici Hukuku' }
            };

            // Cevaptaki ilk eşleşen tipi bul
            for (const [key, value] of Object.entries(typeMap)) {
                if (answer.includes(key)) {
                    this._setCache(cacheKey, value);
                    console.log(`[AI] Dava tipi algılandı: ${value.label}`);
                    return value;
                }
            }

            // Eşleşme yoksa genel
            const result = { type: 'genel', label: 'Genel' };
            this._setCache(cacheKey, result);
            return result;

        } catch (e) {
            console.error('[AI] Dava tipi algılama hatası:', e);
            // Hata durumunda eski regex yöntemine fallback
            return this.detectCaseType(question);
        }
    },

    // Gemini ile karar özetleme - Groq limitini korur
    async summarizeKararWithGemini(kararContent, meta = {}) {
        const cacheKey = `summary_${meta.esasNo || kararContent.slice(0, 50)}`;
        const cached = this._getCache(cacheKey);
        if (cached) return cached;

        try {
            const prompt = `Bu Yargıtay kararını avukat için özetle. SADECE şu formatta yaz, başka bir şey ekleme:

SONUÇ: [ONAMA/BOZMA/RED/KISMEN KABUL - tek kelime]
KONU: [Dava konusu - 1 cümle, max 100 karakter]
GEREKÇE: [Mahkemenin ana gerekçesi - 1-2 cümle, max 150 karakter]
EMSAL DEĞERİ: [Bu karar avukata ne söylüyor - 1 cümle]

KARAR METNİ:
${kararContent.slice(0, 4000)}`;

            const response = await fetch(`${CONFIG.GEMINI_API}?key=${CONFIG.GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 200
                    }
                })
            });

            const data = await response.json();
            const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            if (summary) {
                // Özeti parse et
                const result = {
                    daire: meta.daire || '',
                    esasNo: meta.esasNo || '',
                    kararNo: meta.kararNo || '',
                    tarih: meta.tarih || '',
                    ozet: summary.trim(),
                    raw: kararContent // Orijinali sakla (modal için)
                };

                console.log(`[Gemini] Karar özetlendi: ${meta.esasNo}`);
                this._setCache(cacheKey, result);
                return result;
            }

            // Gemini başarısız olursa ham içerik dön
            return { ...meta, ozet: kararContent.slice(0, 500), raw: kararContent };

        } catch (e) {
            console.error('[Gemini] Özetleme hatası:', e);
            // Fallback: İlk 500 karakter
            return { ...meta, ozet: kararContent.slice(0, 500), raw: kararContent };
        }
    },

    async searchCases(keyword, timeout = 10000, daire = null) {
        // Önbellekten kontrol
        const cacheKey = `search_${keyword}_${daire || 'all'}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            // URL oluştur - daire parametresi varsa ekle
            let url = `${CONFIG.YARGI_API}/search?keyword=${encodeURIComponent(keyword)}`;
            if (daire) {
                url += `&daire=${encodeURIComponent(daire)}`;
            }

            const response = await fetch(url, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();

            if (data.success && data.decisions?.length > 0) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            if (e.name === 'AbortError') {
                return { success: false, decisions: [], error: 'Yargıtay API timeout' };
            }
            return { success: false, decisions: [], error: this._formatError(e.message) };
        }
    },

    async getDocument(id) {
        // Önbellekten kontrol
        const cacheKey = `doc_${id}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/document?id=${id}`);
            const data = await response.json();

            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // API durumu kontrol
    async checkStatus() {
        try {
            const response = await fetch(`${CONFIG.YARGI_API}/`, {
                method: 'GET',
                timeout: 5000
            });
            return response.ok;
        } catch {
            return false;
        }
    },

    // Rate limit sıfırla (manuel)
    resetRateLimit() {
        this._rateLimitUntil = 0;
    },

    // Önbelleği temizle
    clearCache() {
        this._cache.clear();
    },

    // ==================== YENİ API'LER ====================

    // Danıştay kararları arama
    async searchDanistay(keyword, timeout = 10000) {
        const cacheKey = `danistay_${keyword}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = await fetch(`${CONFIG.YARGI_API}/danistay?keyword=${encodeURIComponent(keyword)}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();

            // Daire bilgisi eksikse "Danıştay" olarak ata
            if (data.success && data.decisions) {
                data.decisions = data.decisions.map(d => ({
                    ...d,
                    daire: d.daire || 'Danıştay'
                }));
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            if (e.name === 'AbortError') {
                return { success: false, decisions: [], error: 'Danıştay API timeout' };
            }
            return { success: false, decisions: [], error: this._formatError(e.message) };
        }
    },

    // Danıştay karar içeriği
    async getDanistayDocument(id) {
        const cacheKey = `danistay_doc_${id}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/danistay/document?id=${id}`);
            const data = await response.json();

            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // Mevzuat/Kanun arama (TCK, CMK vb.)
    async getMevzuat(kanunKodu) {
        const cacheKey = `mevzuat_${kanunKodu}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/mevzuat?query=${encodeURIComponent(kanunKodu)}`);
            const data = await response.json();

            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // Belirli bir kanun maddesi getir
    async getMevzuatMadde(kanun, maddeNo) {
        const cacheKey = `madde_${kanun}_${maddeNo}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/mevzuat/madde?kanun=${encodeURIComponent(kanun)}&madde=${maddeNo}`);
            const data = await response.json();

            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // Anayasa Mahkemesi kararları arama
    async searchAYM(keyword) {
        const cacheKey = `aym_${keyword}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/aym?keyword=${encodeURIComponent(keyword)}`);
            const data = await response.json();

            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // TCK maddesi çıkarma yardımcı fonksiyonu
    extractTCKMadde(text) {
        const matches = text.match(/TCK\s*(\d+)/gi) || [];
        return matches.map(m => {
            const num = m.match(/\d+/);
            return num ? num[0] : null;
        }).filter(Boolean);
    },

    // ==================== KARAR PARSE SİSTEMİ ====================

    // Ham karar metnini yapılandırılmış veriye dönüştür
    parseKarar(rawContent, meta = {}) {
        if (!rawContent) return null;

        const parsed = {
            // Meta bilgiler (API'den gelen)
            daire: meta.daire || this._extractDaire(rawContent),
            esasNo: meta.esasNo || '',
            kararNo: meta.kararNo || '',
            tarih: meta.tarih || '',
            kaynak: meta.kaynak || 'yargitay',

            // Çıkarılan bilgiler
            sonuc: this._extractSonuc(rawContent),
            ceza: this._extractCeza(rawContent),
            maddeler: this._extractMaddeler(rawContent),
            sucTuru: this._extractSucTuru(rawContent),

            // Özet bilgiler
            kararOzeti: this._extractKararOzeti(rawContent),
            kritikBolum: this._extractKritikBolum(rawContent),

            // Ham içerik (gerekirse)
            rawLength: rawContent.length
        };

        return parsed;
    },

    // Mahkeme sonucunu çıkar
    _extractSonuc(text) {
        const t = text.toUpperCase();
        if (t.includes('ONANMASINA') || t.includes('ONAMA')) return 'ONAMA';
        if (t.includes('BOZULMASINA') || t.includes('BOZMA')) return 'BOZMA';
        if (t.includes('BERAAT')) return 'BERAAT';
        if (t.includes('MAHKUM') || t.includes('CEZALANDIRILMASINA')) return 'MAHKUMIYET';
        if (t.includes('DÜŞÜRÜLMESINE') || t.includes('DÜŞME')) return 'DÜŞME';
        if (t.includes('REDDİNE') || t.includes('RED')) return 'RET';
        if (t.includes('KABULÜNE') || t.includes('KABUL')) return 'KABUL';
        return 'BELİRSİZ';
    },

    // Ceza miktarını çıkar
    _extractCeza(text) {
        // "X yıl Y ay hapis" formatı
        const yilAyMatch = text.match(/(\d+)\s*yıl\s*(\d+)?\s*(ay)?\s*(hapis)?/i);
        if (yilAyMatch) {
            const yil = yilAyMatch[1];
            const ay = yilAyMatch[2] || '';
            return ay ? `${yil} yıl ${ay} ay hapis` : `${yil} yıl hapis`;
        }

        // Sadece ay
        const ayMatch = text.match(/(\d+)\s*ay\s*(hapis)?/i);
        if (ayMatch) return `${ayMatch[1]} ay hapis`;

        // Para cezası
        const paraMatch = text.match(/(\d+[\d.,]*)\s*(TL|lira)\s*(adli para|para cezası)?/i);
        if (paraMatch) return `${paraMatch[1]} TL adli para cezası`;

        return null;
    },

    // İlgili kanun maddelerini çıkar
    _extractMaddeler(text) {
        const maddeler = [];

        // TCK maddeleri
        const tckMatches = text.match(/TCK\.?\s*'?\s*n?[ıi]n\s*(\d+)/gi) || [];
        const tckDirect = text.match(/TCK\s*(\d+)/gi) || [];
        [...tckMatches, ...tckDirect].forEach(m => {
            const num = m.match(/\d+/);
            if (num) maddeler.push({ kanun: 'TCK', madde: num[0] });
        });

        // CMK maddeleri
        const cmkMatches = text.match(/CMK\.?\s*'?\s*n?[ıi]n\s*(\d+)/gi) || [];
        const cmkDirect = text.match(/CMK\s*(\d+)/gi) || [];
        [...cmkMatches, ...cmkDirect].forEach(m => {
            const num = m.match(/\d+/);
            if (num) maddeler.push({ kanun: 'CMK', madde: num[0] });
        });

        // İİK maddeleri
        const iikMatches = text.match(/İİK\.?\s*'?\s*n?[ıi]n\s*(\d+)/gi) || [];
        iikMatches.forEach(m => {
            const num = m.match(/\d+/);
            if (num) maddeler.push({ kanun: 'İİK', madde: num[0] });
        });

        // TMK maddeleri
        const tmkMatches = text.match(/TMK\.?\s*'?\s*n?[ıi]n\s*(\d+)/gi) || [];
        tmkMatches.forEach(m => {
            const num = m.match(/\d+/);
            if (num) maddeler.push({ kanun: 'TMK', madde: num[0] });
        });

        // Tekrarları kaldır
        const unique = [];
        const seen = new Set();
        maddeler.forEach(m => {
            const key = `${m.kanun}_${m.madde}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(m);
            }
        });

        return unique.slice(0, 5); // Max 5 madde
    },

    // Suç türünü çıkar
    _extractSucTuru(text) {
        const t = text.toLowerCase();

        const suclar = [
            { pattern: /dolandırıcılık/, tur: 'Dolandırıcılık' },
            { pattern: /hırsızlık/, tur: 'Hırsızlık' },
            { pattern: /yaralama|darp|müessir/, tur: 'Kasten Yaralama' },
            { pattern: /öldürme|adam öldürme|kasten öldürme/, tur: 'Kasten Öldürme' },
            { pattern: /taksirle öldürme/, tur: 'Taksirle Öldürme' },
            { pattern: /tehdit/, tur: 'Tehdit' },
            { pattern: /hakaret/, tur: 'Hakaret' },
            { pattern: /cinsel saldırı/, tur: 'Cinsel Saldırı' },
            { pattern: /cinsel istismar/, tur: 'Cinsel İstismar' },
            { pattern: /uyuşturucu/, tur: 'Uyuşturucu' },
            { pattern: /güveni kötüye kullanma/, tur: 'Güveni Kötüye Kullanma' },
            { pattern: /sahtecilik|sahte/, tur: 'Sahtecilik' },
            { pattern: /zimmet/, tur: 'Zimmet' },
            { pattern: /rüşvet/, tur: 'Rüşvet' },
            { pattern: /boşanma/, tur: 'Boşanma' },
            { pattern: /nafaka/, tur: 'Nafaka' },
            { pattern: /velayet/, tur: 'Velayet' },
            { pattern: /icra/, tur: 'İcra Takibi' },
            { pattern: /itirazın iptali/, tur: 'İtirazın İptali' },
            { pattern: /işe iade/, tur: 'İşe İade' },
            { pattern: /kıdem tazminat/, tur: 'Kıdem Tazminatı' },
            { pattern: /ihbar tazminat/, tur: 'İhbar Tazminatı' }
        ];

        for (const suc of suclar) {
            if (suc.pattern.test(t)) return suc.tur;
        }

        return null;
    },

    // Daire bilgisini çıkar
    _extractDaire(text) {
        const match = text.match(/(\d+)\.\s*(Ceza|Hukuk)\s*(Dairesi|HD|CD)/i);
        if (match) {
            const tip = match[2].toLowerCase().includes('ceza') ? 'CD' : 'HD';
            return `${match[1]}. ${tip}`;
        }
        return null;
    },

    // Karar özeti çıkar (ilk anlamlı paragraf)
    _extractKararOzeti(text) {
        // Çok kısa ise direkt döndür
        if (text.length < 300) return text;

        // İlk 600 karakter + son cümleye kadar
        let ozet = text.substring(0, 600);
        const sonNokta = ozet.lastIndexOf('.');
        if (sonNokta > 300) {
            ozet = ozet.substring(0, sonNokta + 1);
        }

        return ozet.trim();
    },

    // Kritik bölümü çıkar (SONUÇ, HÜKÜM vs.)
    _extractKritikBolum(text) {
        const patterns = [
            /SONUÇ\s*:[\s\S]{0,800}/i,
            /HÜKÜM\s*:[\s\S]{0,800}/i,
            /KARAR\s*:[\s\S]{0,800}/i,
            /Bu nedenlerle[\s\S]{0,500}/i,
            /Yukarıda açıklanan nedenlerle[\s\S]{0,500}/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[0].trim().substring(0, 500);
            }
        }

        // Bulunamadıysa son 400 karakter
        if (text.length > 400) {
            return '...' + text.substring(text.length - 400).trim();
        }

        return null;
    },

    // ==================== AKILLI KAYNAK SEÇİMİ ====================

    // Soruya en alakalı kararı bul
    findBestMatch(soru, kararlar) {
        if (!kararlar || kararlar.length === 0) return [];

        const scores = kararlar.map(k => ({
            karar: k,
            skor: this._calculateRelevance(soru, k)
        }));

        // Skora göre sırala ve en iyi 2'yi döndür
        return scores
            .sort((a, b) => b.skor - a.skor)
            .slice(0, 2)
            .map(s => s.karar);
    },

    // Alaka skorunu hesapla
    _calculateRelevance(soru, karar) {
        let skor = 0;
        const soruLower = soru.toLowerCase();
        const soruKelimeler = soruLower.split(/\s+/).filter(k => k.length > 3);

        // Parsed veri varsa onu kullan
        const metin = (karar.sucTuru || '') + ' ' +
                      (karar.kararOzeti || '') + ' ' +
                      (karar.kritikBolum || '') +
                      (karar.content || '').substring(0, 1000);
        const metinLower = metin.toLowerCase();

        // Keyword eşleşmesi
        soruKelimeler.forEach(kelime => {
            if (metinLower.includes(kelime)) skor += 10;
        });

        // Suç türü eşleşmesi (yüksek puan)
        if (karar.sucTuru) {
            if (soruLower.includes(karar.sucTuru.toLowerCase())) skor += 50;
        }

        // Sonuç türü bonus
        if (karar.sonuc === 'ONAMA') skor += 5;  // Yerleşik içtihat
        if (karar.sonuc === 'BOZMA') skor += 3;  // Değişen içtihat

        // Ceza bilgisi varsa bonus
        if (karar.ceza) skor += 10;

        // Madde eşleşmesi
        if (karar.maddeler && karar.maddeler.length > 0) {
            const sorudakiMaddeler = soru.match(/\d+/g) || [];
            karar.maddeler.forEach(m => {
                if (sorudakiMaddeler.includes(m.madde)) skor += 30;
            });
        }

        return skor;
    },

    // Yapılandırılmış context oluştur (AI için optimize)
    buildStructuredContext(parsedKararlar, mevzuatlar) {
        let context = '';

        if (parsedKararlar && parsedKararlar.length > 0) {
            context += '\n\n=== EMSAL KARARLAR (Bu kaynaklardan MUTLAKA alıntı yap) ===\n';
            parsedKararlar.forEach((k, i) => {
                context += `\n[${i + 1}] ${k.kaynak === 'danistay' ? 'Danıştay' : 'Yargıtay'} ${k.daire || ''}\n`;
                context += `    Esas: ${k.esasNo}, Karar: ${k.kararNo}`;
                if (k.tarih) context += `, Tarih: ${k.tarih}`;
                context += '\n';

                // Gemini özeti varsa onu kullan (çok daha kısa ve öz)
                if (k.ozet) {
                    context += `${k.ozet}\n`;
                } else {
                    // Fallback: Eski parse sistemi
                    if (k.sucTuru) context += `    Konu: ${k.sucTuru}\n`;
                    if (k.sonuc) context += `    Mahkeme Kararı: ${k.sonuc}\n`;
                    if (k.ceza) context += `    Verilen Ceza: ${k.ceza}\n`;
                    if (k.maddeler && k.maddeler.length > 0) {
                        context += `    Uygulanan Maddeler: ${k.maddeler.map(m => `${m.kanun} m.${m.madde}`).join(', ')}\n`;
                    }
                    if (k.kritikBolum) {
                        context += `    Gerekçe: ${k.kritikBolum.substring(0, 500)}\n`;
                    }
                    if (k.kararOzeti && k.kararOzeti.length > 100) {
                        context += `    Özet: ${k.kararOzeti.substring(0, 400)}\n`;
                    }
                }
            });
        }

        if (mevzuatlar && mevzuatlar.length > 0) {
            context += '\n=== İLGİLİ KANUN MADDELERİ ===\n';
            mevzuatlar.forEach(m => {
                const kanunAdi = m.kanunAdi || 'Kanun';
                context += `\n${kanunAdi} Madde ${m.madde}:\n`;
                context += `${(m.content || '').substring(0, 400)}\n`;
            });
        }

        if (!parsedKararlar?.length && !mevzuatlar?.length) {
            context += '\n\n[Emsal karar bulunamadı - Genel Yargıtay içtihadı bilgisiyle yanıtla]\n';
        }

        return context;
    },

    // Kanun kodu mapping - her dava tipi için en kritik 2 madde + daire bilgisi
    KANUN_MAP: {
        ceza: {
            kaynaklar: ['yargitay'],
            daireler: ['Ceza Dairesi', 'Ceza Genel Kurulu'],  // Tüm ceza daireleri
            kanunlar: [
                { kod: 5237, ad: 'TCK', maddeler: [157, 168] },      // dolandırıcılık + etkin pişmanlık
                { kod: 5271, ad: 'CMK', maddeler: [253, 231] }       // uzlaşma + HAGB
            ]
        },
        icra: {
            kaynaklar: ['yargitay'],
            daireler: ['12. Hukuk Dairesi'],
            kanunlar: [
                { kod: 2004, ad: 'İİK', maddeler: [62, 72] }         // itiraz + menfi tespit
            ]
        },
        aile: {
            kaynaklar: ['yargitay'],
            daireler: ['2. Hukuk Dairesi'],
            kanunlar: [
                { kod: 4721, ad: 'TMK', maddeler: [166, 175] }       // boşanma + nafaka
            ]
        },
        is: {
            kaynaklar: ['yargitay'],
            daireler: ['9. Hukuk Dairesi'],
            kanunlar: [
                { kod: 4857, ad: 'İş Kanunu', maddeler: [18, 20, 21, 25] }   // geçerli fesih + işe iade + feshin sonuçları + haklı fesih
            ]
        },
        idari: {
            kaynaklar: ['danistay'],
            daireler: [],  // Danıştay için daire filtresi yok
            kanunlar: [
                { kod: 2577, ad: 'İYUK', maddeler: [7, 11] }         // dava süresi + üst makam
            ]
        },
        miras: {
            kaynaklar: ['yargitay'],
            daireler: ['1. Hukuk Dairesi', '14. Hukuk Dairesi'],
            kanunlar: [
                { kod: 4721, ad: 'TMK', maddeler: [505, 606] }       // saklı pay + reddi miras
            ]
        },
        ticaret: {
            kaynaklar: ['yargitay'],
            daireler: ['11. Hukuk Dairesi'],
            kanunlar: [
                { kod: 6102, ad: 'TTK', maddeler: [18, 124] }        // tacir + ticari işletme
            ]
        },
        tuketici: {
            kaynaklar: ['yargitay'],
            daireler: ['3. Hukuk Dairesi', '13. Hukuk Dairesi'],
            kanunlar: [
                { kod: 6502, ad: 'TKHK', maddeler: [4, 11] }         // haksız şart + ayıplı mal
            ]
        }
    },

    // Dava tipi algılama
    detectCaseType(question) {
        const q = question.toLowerCase();

        // Ceza Hukuku
        if (q.match(/tck|ceza|suç|hapis|tutuklama|savcı|kovuşturma|soruşturma|müşteki|sanık|mağdur|şikayet|uzlaşma|hagb|dolandırıcılık|hırsızlık|yaralama|tehdit|kasten|taksir|darp/)) {
            return { type: 'ceza', label: 'Ceza Hukuku' };
        }
        // İcra Hukuku
        if (q.match(/icra|haciz|itiraz|ödeme emri|takip|borçlu|alacaklı|kambiyo|senet|çek|iflas|konkordato|rehin|ipotek|kıymet takdiri/)) {
            return { type: 'icra', label: 'İcra Hukuku' };
        }
        // Aile Hukuku (word boundary ile - "çıkarıldı" içindeki "karı" eşleşmesin)
        if (q.match(/boşanma|nafaka|velayet|mal paylaşım|edinilmiş mal|ziynet|evlilik|nişan|aile konut|\beş\b|\bkarı\b|\bkoca\b|müşterek konut/)) {
            return { type: 'aile', label: 'Aile Hukuku' };
        }
        // İş Hukuku
        if (q.match(/işçi|işveren|kıdem|ihbar|fesih|işe iade|fazla mesai|yıllık izin|iş kazası|sgk|sigorta|mobbing|arabulucu|işkur|işten çıkar|performans|iş sözleşme|4857/)) {
            return { type: 'is', label: 'İş Hukuku' };
        }
        // İdari Hukuku
        if (q.match(/idari|iptal|tam yargı|belediye|imar|ruhsat|kamulaştırma|memur|disiplin|ihale|vergi|danıştay/)) {
            return { type: 'idari', label: 'İdari Hukuk' };
        }
        // Miras Hukuku
        if (q.match(/miras|tereke|veraset|vasiyet|saklı pay|tenkis|reddi miras|mirasçı|muris|intikal/)) {
            return { type: 'miras', label: 'Miras Hukuku' };
        }

        return { type: 'genel', label: 'Genel' };
    },

    // Genişletilmiş keyword çıkarma
    extractKeywords(question) {
        const keywordPatterns = [
            // Kanun maddeleri
            /TCK\s*\d+/gi, /CMK\s*\d+/gi, /TMK\s*\d+/gi, /İİK\s*\d+/gi, /HMK\s*\d+/gi,
            // Ceza terimleri
            /dolandırıcılık|hırsızlık|yaralama|tehdit|hakaret|iftira|güveni kötüye kullanma|zimmet|rüşvet|kasten öldürme|taksirle öldürme|cinsel saldırı|cinsel istismar|uyuşturucu/gi,
            // İcra terimleri
            /icra takip|haciz|ödeme emri|itiraz|kambiyo|senet|çek|ipotek|rehin|iflas|konkordato|tasarrufun iptali/gi,
            // Aile terimleri
            /boşanma|nafaka|velayet|mal paylaşım|ziynet|tazminat|çocuk teslimi|kişisel ilişki/gi,
            // İş terimleri
            /işe iade|kıdem tazminat|ihbar tazminat|fazla mesai|mobbing|iş kazası|haksız fesih|haklı fesih/gi,
            // Genel hukuk terimleri
            /zamanaşımı|hak düşürücü süre|temyiz|istinaf|itiraz|başvuru|dava|mahkeme/gi
        ];

        let keywords = [];
        keywordPatterns.forEach(pattern => {
            const matches = question.match(pattern) || [];
            keywords = keywords.concat(matches);
        });

        // Tekrarları kaldır ve ilk 3'ü al
        return [...new Set(keywords.map(k => k.toLowerCase()))].slice(0, 3);
    },

    // Belirli kanun maddesini çek (kanun kodu ile)
    async getKanunMaddesi(kanunKodu, maddeNo) {
        const cacheKey = `kanun_${kanunKodu}_${maddeNo}`;
        const cached = this._getCache(cacheKey);
        if (cached) return { ...cached, fromCache: true };

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/mevzuat/madde?kanun=${kanunKodu}&madde=${maddeNo}`);
            const data = await response.json();
            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
        }
    },

    // Çoklu arama sorguları oluştur - farklı açılardan ara
    generateSearchQueries(question, caseType) {
        const queries = [];
        const keywords = this.extractKeywords(question);

        // 1. Ana keyword sorgusu
        if (keywords.length > 0) {
            queries.push(keywords.slice(0, 2).join(' '));
        }

        // 2. Dava tipine göre ek sorgular (API'nin iyi sonuç verdiği terimler)
        // NOT: API bazı terimlerde doğru daire döndürmüyor, kanun numaraları daha güvenilir
        const typeKeywords = {
            ceza: ['5237', 'TCK', 'savunma', 'beraat'],  // 5237 = TCK numarası
            icra: ['2004', 'İİK', 'itiraz', 'menfi tespit'],  // 2004 = İİK numarası
            aile: ['4721', 'TMK', 'boşanma', 'nafaka'],  // 4721 = TMK numarası
            is: ['4857', 'işçi', 'işveren', 'fesih'],  // 4857 = İş Kanunu numarası - API bu numara ile %100 doğru daire döndürüyor
            idari: ['2577', 'İYUK', 'iptal davası', 'idari işlem'],  // 2577 = İYUK numarası
            miras: ['miras', 'tereke', 'veraset', 'mirasçı']
        };

        if (caseType && typeKeywords[caseType]) {
            // Önce kanun numarasını ekle (API ile en güvenilir sonuç)
            const kanunNo = typeKeywords[caseType][0]; // İlk eleman kanun numarası
            if (!queries.includes(kanunNo)) {
                queries.unshift(kanunNo); // Başa ekle
            }

            // Sonra soruyla eşleşen keyword'ü ekle
            const extraKeyword = typeKeywords[caseType].slice(1).find(k =>
                question.toLowerCase().includes(k) || keywords.some(kw => k.includes(kw))
            );
            if (extraKeyword && !queries.includes(extraKeyword)) {
                queries.push(extraKeyword);
            }
        }

        // 3. Soru içindeki önemli kelimeler
        const importantWords = question
            .split(/\s+/)
            .filter(w => w.length > 5)
            .filter(w => !['müvekkilim', 'müvekkil', 'avukat', 'dava', 'mahkeme'].includes(w.toLowerCase()))
            .slice(0, 2);

        if (importantWords.length > 0) {
            const altQuery = importantWords.join(' ');
            if (!queries.includes(altQuery)) {
                queries.push(altQuery);
            }
        }

        return queries.slice(0, 3); // Max 3 farklı sorgu
    },

    // Zenginleştirilmiş context oluştur - ÇOKLU ARAMA STRATEJİSİ
    async buildEnrichedContext(question) {
        const context = {
            yargitayKararlari: [],
            danistayKararlari: [],
            mevzuatMaddeleri: [],
            aymKararlari: [],
            caseType: null
        };

        // Dava tipini regex ile algıla (AI rate limit sorunu geçici çözüm)
        // TODO: Rate limit düzelince detectCaseTypeAI'a geri dön
        context.caseType = this.detectCaseType(question);
        console.log('[Context] Dava tipi (regex):', context.caseType.label);
        const caseConfig = this.KANUN_MAP[context.caseType.type];

        // Çoklu arama sorguları oluştur
        const searchQueries = this.generateSearchQueries(question, context.caseType.type);
        console.log('[Context] Search queries:', searchQueries);
        const primaryQuery = searchQueries[0] || question.split(' ').filter(w => w.length > 4).slice(0, 3).join(' ');

        // Paralel API çağrıları
        const promises = [];
        const seenIds = new Set(); // Tekrar eden kararları önle

        // === ÇOKLU ARAMA STRATEJİSİ ===

        if (caseConfig) {
            // 1. Dava tipine göre mahkeme kararları - birden fazla sorgu ile
            if (caseConfig.kaynaklar.includes('danistay')) {
                for (const query of searchQueries.slice(0, 2)) {
                    promises.push(
                        this.searchDanistay(query).then(r => {
                            if (r.success) {
                                r.decisions.forEach(d => {
                                    if (!seenIds.has(d.id) && context.danistayKararlari.length < 3) {
                                        seenIds.add(d.id);
                                        context.danistayKararlari.push(d);
                                    }
                                });
                            }
                        }).catch(() => {})
                    );
                }
            }

            if (caseConfig.kaynaklar.includes('yargitay')) {
                // Dava tipine uygun daire varsa filtrele
                const daire = caseConfig.daireler?.[0] || null;
                console.log('[Context] Yargıtay araması başlıyor, daire:', daire);

                for (const query of searchQueries.slice(0, 2)) {
                    promises.push(
                        this.searchCases(query, 10000, daire).then(r => {
                            console.log('[Context] Yargıtay arama sonucu:', query, r.success, r.decisions?.length || 0);
                            if (r.success) {
                                r.decisions.forEach(d => {
                                    // Daire filtresi ile gelen sonuçları kontrol et
                                    const isRelevantDaire = !caseConfig.daireler?.length ||
                                        caseConfig.daireler.some(cd => d.daire?.includes(cd));

                                    if (!seenIds.has(d.id) && context.yargitayKararlari.length < 3 && isRelevantDaire) {
                                        seenIds.add(d.id);
                                        context.yargitayKararlari.push(d);
                                        console.log('[Context] Karar eklendi:', d.daire, d.esasNo);
                                    }
                                });
                            }
                        }).catch(e => { console.error('[Search] Yargıtay arama hatası:', e); })
                    );
                }
            }

            // 2. Dava tipine göre ilgili kanun maddeleri
            for (const kanun of caseConfig.kanunlar) {
                const kritikMaddeler = kanun.maddeler.slice(0, 2);
                for (const maddeNo of kritikMaddeler) {
                    promises.push(
                        this.getKanunMaddesi(kanun.kod, maddeNo).then(r => {
                            if (r.success) {
                                context.mevzuatMaddeleri.push({
                                    ...r,
                                    kanunAdi: kanun.ad,
                                    kanunKodu: kanun.kod
                                });
                            }
                        }).catch(() => {})
                    );
                }
            }
        } else {
            // Genel dava - çoklu sorgu ile Yargıtay'a bak
            for (const query of searchQueries) {
                promises.push(
                    this.searchCases(query).then(r => {
                        if (r.success) {
                            r.decisions.forEach(d => {
                                if (!seenIds.has(d.id) && context.yargitayKararlari.length < 4) {
                                    seenIds.add(d.id);
                                    context.yargitayKararlari.push(d);
                                }
                            });
                        }
                    }).catch(() => {})
                );
            }
        }

        // 3. Soruda açıkça belirtilen kanun maddeleri
        const tckMaddeleri = this.extractTCKMadde(question);
        for (const madde of tckMaddeleri.slice(0, 2)) {
            promises.push(
                this.getKanunMaddesi(5237, madde).then(r => {
                    if (r.success && !context.mevzuatMaddeleri.find(m => m.madde === madde)) {
                        context.mevzuatMaddeleri.push({ ...r, kanunAdi: 'TCK', kanunKodu: 5237 });
                    }
                }).catch(() => {})
            );
        }

        // 4. Anayasal konu varsa AYM kararları
        if (question.match(/anayasa|temel hak|ihlal|özgürlük|bireysel başvuru/i)) {
            promises.push(
                this.searchAYM(primaryQuery).then(r => {
                    if (r.success) context.aymKararlari = r.decisions.slice(0, 2);
                }).catch(() => {})
            );
        }

        await Promise.all(promises);
        return context;
    }
};
