// nevolve.ai API Module
const API = {
    // Gemini AI Request
    async askAI(question) {
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
            return { success: true, text: data.candidates[0].content.parts[0].text };
        }
        return { success: false, error: data.error?.message || 'Bilinmeyen hata' };
    },
    
    // Search Yargıtay Decisions
    async searchCases(keyword) {
        const response = await fetch(`${CONFIG.YARGI_API}/search?keyword=${encodeURIComponent(keyword)}`);
        return await response.json();
    },
    
    // Get Document Content
    async getDocument(id) {
        const response = await fetch(`${CONFIG.YARGI_API}/document?id=${id}`);
        return await response.json();
    },
    
    // Check API Status
    async checkStatus() {
        try {
            const response = await fetch(CONFIG.YARGI_API);
            return response.ok;
        } catch {
            return false;
        }
    }
};