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

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

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

    async searchCases(keyword) {
        // Önbellekten kontrol
        const cacheKey = `search_${keyword}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/search?keyword=${encodeURIComponent(keyword)}`);
            const data = await response.json();

            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
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
    async searchDanistay(keyword) {
        const cacheKey = `danistay_${keyword}`;
        const cached = this._getCache(cacheKey);
        if (cached) {
            return { ...cached, fromCache: true };
        }

        try {
            const response = await fetch(`${CONFIG.YARGI_API}/danistay?keyword=${encodeURIComponent(keyword)}`);
            const data = await response.json();

            if (data.success) {
                this._setCache(cacheKey, data);
            }
            return data;
        } catch (e) {
            return { success: false, error: this._formatError(e.message) };
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

    // Kanun kodu mapping - her dava tipi için en kritik 2 madde
    KANUN_MAP: {
        ceza: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 5237, ad: 'TCK', maddeler: [157, 168] },      // dolandırıcılık + etkin pişmanlık
                { kod: 5271, ad: 'CMK', maddeler: [253, 231] }       // uzlaşma + HAGB
            ]
        },
        icra: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 2004, ad: 'İİK', maddeler: [62, 72] }         // itiraz + menfi tespit
            ]
        },
        aile: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 4721, ad: 'TMK', maddeler: [166, 175] }       // boşanma + nafaka
            ]
        },
        is: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 4857, ad: 'İş Kanunu', maddeler: [20, 25] }   // işe iade + haklı fesih
            ]
        },
        idari: {
            kaynaklar: ['danistay'],
            kanunlar: [
                { kod: 2577, ad: 'İYUK', maddeler: [7, 11] }         // dava süresi + üst makam
            ]
        },
        miras: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 4721, ad: 'TMK', maddeler: [505, 606] }       // saklı pay + reddi miras
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
        // Aile Hukuku
        if (q.match(/boşanma|nafaka|velayet|mal paylaşım|edinilmiş mal|ziynet|çocuk|evlilik|nişan|aile|eş|karı|koca|müşterek/)) {
            return { type: 'aile', label: 'Aile Hukuku' };
        }
        // İş Hukuku
        if (q.match(/işçi|işveren|kıdem|ihbar|fesih|işe iade|fazla mesai|yıllık izin|iş kazası|sgk|sigorta|mobbing|arabulucu|işkur/)) {
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

        // 2. Dava tipine göre ek sorgular
        const typeKeywords = {
            ceza: ['savunma', 'beraat', 'ceza indirimi', 'etkin pişmanlık'],
            icra: ['itiraz', 'menfi tespit', 'istirdat'],
            aile: ['boşanma', 'nafaka', 'velayet'],
            is: ['işe iade', 'fesih', 'tazminat'],
            idari: ['iptal davası', 'yürütme durdurma']
        };

        if (caseType && typeKeywords[caseType]) {
            const extraKeyword = typeKeywords[caseType].find(k =>
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

        // Dava tipini algıla
        context.caseType = this.detectCaseType(question);
        const caseConfig = this.KANUN_MAP[context.caseType.type];

        // Çoklu arama sorguları oluştur
        const searchQueries = this.generateSearchQueries(question, context.caseType.type);
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
                for (const query of searchQueries.slice(0, 2)) {
                    promises.push(
                        this.searchCases(query).then(r => {
                            if (r.success) {
                                r.decisions.forEach(d => {
                                    if (!seenIds.has(d.id) && context.yargitayKararlari.length < 3) {
                                        seenIds.add(d.id);
                                        context.yargitayKararlari.push(d);
                                    }
                                });
                            }
                        }).catch(() => {})
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
