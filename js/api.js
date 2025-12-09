// nevolve.ai API Module
const API = {
    async askAI(question) {
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
            
            // Debug: Console'a tam yanıtı yazdır
            console.log('=== GEMINI RAW RESPONSE ===');
            console.log('Full data:', data);
            
            if (data.candidates?.[0]) {
                const fullText = data.candidates[0].content.parts[0].text;
                console.log('Text length:', fullText.length);
                console.log('Word count:', fullText.split(/\s+/).length);
                console.log('Full text:', fullText);
                console.log('Finish reason:', data.candidates[0].finishReason);
                return { success: true, text: fullText };
            }
            
            console.log('ERROR:', data.error);
            return { success: false, error: data.error?.message || 'Bilinmeyen hata' };
        } catch (e) {
            console.log('FETCH ERROR:', e);
            return { success: false, error: e.message };
        }
    },
    
    async searchCases(keyword) {
        try {
            const response = await fetch(`${CONFIG.YARGI_API}/search?keyword=${encodeURIComponent(keyword)}`);
            return await response.json();
        } catch (e) {
            return { success: false, error: e.message };
        }
    },
    
    async getDocument(id) {
        try {
            const response = await fetch(`${CONFIG.YARGI_API}/document?id=${id}`);
            return await response.json();
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
};
