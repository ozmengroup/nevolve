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
                return { success: true, text: fullText };
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
    }
};
