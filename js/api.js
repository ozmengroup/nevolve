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

    // Zenginleştirilmiş context oluştur
    async buildEnrichedContext(question) {
        const context = {
            yargitayKararlari: [],
            danistayKararlari: [],
            mevzuatMaddeleri: [],
            aymKararlari: []
        };

        // TCK maddelerini çıkar
        const tckMaddeleri = this.extractTCKMadde(question);

        // Anahtar kelimeleri çıkar
        const keywords = question.match(/TCK \d+|CMK \d+|icra|itiraz|uzlaşma|pişmanlık|kambiyo|senet|nafaka|yaralama|dolandırıcılık|hırsızlık|tehdit|HAGB|iptal|idari/gi) || [];
        const searchQuery = keywords.length > 0 ? keywords.slice(0, 2).join(' ') : question.split(' ').filter(w => w.length > 4).slice(0, 2).join(' ');

        // Paralel API çağrıları
        const promises = [];

        // 1. Yargıtay kararları (mevcut)
        promises.push(
            this.searchCases(searchQuery).then(r => {
                if (r.success) context.yargitayKararlari = r.decisions.slice(0, 3);
            }).catch(() => {})
        );

        // 2. İdari dava ise Danıştay kararları
        if (question.match(/idari|vergi|imar|belediye|kamu|memur/i)) {
            promises.push(
                this.searchDanistay(searchQuery).then(r => {
                    if (r.success) context.danistayKararlari = r.decisions.slice(0, 2);
                }).catch(() => {})
            );
        }

        // 3. TCK maddeleri varsa mevzuat çek
        for (const madde of tckMaddeleri.slice(0, 2)) {
            promises.push(
                this.getMevzuatMadde('TCK', madde).then(r => {
                    if (r.success) context.mevzuatMaddeleri.push(r);
                }).catch(() => {})
            );
        }

        // 4. Anayasal konu varsa AYM kararları
        if (question.match(/anayasa|temel hak|iptal|ihlal|özgürlük/i)) {
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
