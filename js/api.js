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

        // Groq veya Gemini kullan
        if (CONFIG.AI_PROVIDER === 'groq') {
            return await this._askGroq(question, retryCount);
        } else {
            return await this._askGemini(question, retryCount);
        }
    },

    // Groq API (Llama 3.3 70B - çok hızlı)
    async _askGroq(question, retryCount = 0) {
        try {
            const response = await fetch(CONFIG.GROQ_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${CONFIG.GROQ_KEY}`
                },
                body: JSON.stringify({
                    model: CONFIG.GROQ_MODEL,
                    messages: [
                        { role: 'system', content: CONFIG.AI_SYSTEM_PROMPT },
                        { role: 'user', content: question }
                    ],
                    temperature: CONFIG.AI_CONFIG.temperature,
                    max_tokens: CONFIG.AI_CONFIG.maxOutputTokens
                })
            });

            const data = await response.json();

            if (data.choices?.[0]?.message?.content) {
                return { success: true, text: data.choices[0].message.content, provider: 'groq' };
            }

            const errorMsg = data.error?.message || 'Bilinmeyen hata';

            // Rate limit hatası
            if (this._isRateLimitError(errorMsg)) {
                this._rateLimitUntil = Date.now() + 10000; // Groq için 10 saniye yeterli

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

    // Gemini API (Fallback)
    async _askGemini(question, retryCount = 0) {
        try {
            const response = await fetch(`${CONFIG.GEMINI_API}?key=${CONFIG.GEMINI_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: CONFIG.AI_SYSTEM_PROMPT + '\n\nSoru: ' + question }] }],
                    generationConfig: CONFIG.AI_CONFIG
                })
            });

            const data = await response.json();

            if (data.candidates?.[0]) {
                const fullText = data.candidates[0].content.parts[0].text;
                return { success: true, text: fullText, provider: 'gemini' };
            }

            const errorMsg = data.error?.message || 'Bilinmeyen hata';

            // Rate limit hatası - 35 saniye bekle
            if (this._isRateLimitError(errorMsg)) {
                this._rateLimitUntil = Date.now() + 35000;

                // Otomatik retry (max 1 kez, 35 saniye sonra)
                if (retryCount < 1) {
                    return {
                        success: false,
                        error: this._formatError(errorMsg),
                        willRetry: true,
                        retryAfter: 35
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

    // Kanun kodu mapping - her dava tipi için ilgili kanunlar ve kritik maddeler
    KANUN_MAP: {
        ceza: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 5237, ad: 'TCK', maddeler: [157, 158, 141, 142, 86, 87, 106, 109] },
                { kod: 5271, ad: 'CMK', maddeler: [253, 254, 231] }
            ]
        },
        icra: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 2004, ad: 'İİK', maddeler: [62, 68, 72, 89, 94, 97] }
            ]
        },
        aile: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 4721, ad: 'TMK', maddeler: [161, 166, 169, 175, 182, 185, 186, 336] }
            ]
        },
        is: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 4857, ad: 'İş Kanunu', maddeler: [17, 18, 20, 21, 25, 41] },
                { kod: 7036, ad: 'İş Mahkemeleri K.', maddeler: [3] }
            ]
        },
        idari: {
            kaynaklar: ['danistay'],  // İdari davalarda Danıştay öncelikli!
            kanunlar: [
                { kod: 2577, ad: 'İYUK', maddeler: [7, 10, 11, 12, 13, 20] }
            ]
        },
        miras: {
            kaynaklar: ['yargitay'],
            kanunlar: [
                { kod: 4721, ad: 'TMK', maddeler: [495, 505, 506, 560, 564, 565, 605, 606] }
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

    // Zenginleştirilmiş context oluştur - DAVA TİPİNE GÖRE AKILLI KAYNAK SEÇİMİ
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

        // Genişletilmiş keyword çıkarma
        const keywords = this.extractKeywords(question);
        const searchQuery = keywords.length > 0
            ? keywords.slice(0, 2).join(' ')
            : question.split(' ').filter(w => w.length > 4).slice(0, 3).join(' ');

        // Paralel API çağrıları
        const promises = [];

        // === DAVA TİPİNE GÖRE KAYNAK SEÇİMİ ===

        if (caseConfig) {
            // 1. Dava tipine göre mahkeme kararları
            if (caseConfig.kaynaklar.includes('danistay')) {
                // İdari dava - Danıştay öncelikli
                promises.push(
                    this.searchDanistay(searchQuery).then(r => {
                        if (r.success) context.danistayKararlari = r.decisions.slice(0, 3);
                    }).catch(() => {})
                );
            }

            if (caseConfig.kaynaklar.includes('yargitay')) {
                // Diğer davalar - Yargıtay
                promises.push(
                    this.searchCases(searchQuery).then(r => {
                        if (r.success) context.yargitayKararlari = r.decisions.slice(0, 3);
                    }).catch(() => {})
                );
            }

            // 2. Dava tipine göre ilgili kanun maddeleri - OTOMATİK ÇEK
            for (const kanun of caseConfig.kanunlar) {
                // Her kanundan en kritik 2-3 maddeyi çek
                const kritikMaddeler = kanun.maddeler.slice(0, 3);
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
            // Genel dava - hem Yargıtay'a bak
            promises.push(
                this.searchCases(searchQuery).then(r => {
                    if (r.success) context.yargitayKararlari = r.decisions.slice(0, 3);
                }).catch(() => {})
            );
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
                this.searchAYM(searchQuery).then(r => {
                    if (r.success) context.aymKararlari = r.decisions.slice(0, 2);
                }).catch(() => {})
            );
        }

        await Promise.all(promises);
        return context;
    }
};
