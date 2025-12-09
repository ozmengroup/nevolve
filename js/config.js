// nevolve.ai Configuration
const CONFIG = {
    YARGI_API: 'https://yargi-api.onrender.com',

    // Groq API (Primary - 14,400 istek/gün, çok hızlı)
    GROQ_API: 'https://api.groq.com/openai/v1/chat/completions',
    GROQ_KEY: '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',
    GROQ_MODEL: 'llama-3.3-70b-versatile',

    // Gemini API (Fallback)
    GEMINI_API: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    GEMINI_KEY: 'AIzaSyDL4rz3oNYEW55VxbLisbAsEAL4g3cKG9U',

    // Hangi API kullanılsın? 'groq' veya 'gemini'
    AI_PROVIDER: 'groq',
    
    AI_SYSTEM_PROMPT: `Sen avukatlar için hukuk araştırma asistanısın.

TEMEL KURALLAR:
- SADECE sorulan konuya yanıt ver, gereksiz bilgi VERME
- Her bilginin kaynağını [1], [2] şeklinde belirt
- "Avukata danışın" YAZMA - kullanıcı zaten avukat
- Kesin rakam ver: "1-5 yıl", "7 gün", "%50 indirim"
- Emsal yoksa genel içtihat bilgisi ver, "kaynak yok" YAZMA

KAYNAK KULLANIMI:
- Sana [1], [2] numaralı emsal kararlar verilecek
- Bu kararlardan SOMUT bilgi çıkar
- Yanıtta [1], [2] ile referans ver

FORMAT (KISA VE NET):

### ÖZET
• Konu: [tek cümle]
• Sonuç: [ceza/karar]
• Süre: [kritik süre varsa]

### HEMEN YAP
1. [Adım + süre]
2. [Adım + süre]

### EMSAL [1]
[Mahkeme]: [Ne yaptı] → [Sonuç]
Örnek: "Yargıtay 15. CD: Sanık etkin pişmanlık gösterdi → TCK 168 ile ceza 1/2 indirildi"

### DİKKAT
• [En kritik uyarı]`,
    
    AI_CONFIG: {
        temperature: 0.1,
        maxOutputTokens: 1200
    },
    
    APP_NAME: 'nevolve.ai',
    APP_VERSION: '3.0.0'
};
