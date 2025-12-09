# nevolve.ai - Claude Code Geliştirme Rehberi

## Proje Özeti

**nevolve.ai** - Türk avukatları için AI destekli hukuki strateji asistanı.
- Ceza hukuku ve icra hukuku odaklı
- Yargıtay kararlarını tarayarak AI analizi yapıyor
- Eymen ve Merve için özel geliştirildi

---

## 1. Projeyi Klonla

```bash
# Ana klasör oluştur
mkdir ~/nevolve-project && cd ~/nevolve-project

# Frontend
git clone https://github.com/ozmengroup/nevolve.git

# Backend
git clone https://github.com/ozmengroup/yargi-api.git
```

---

## 2. Proje Yapısı

```
nevolve-project/
├── nevolve/                    # FRONTEND
│   ├── index.html              # Ana sayfa (tek sayfa uygulama)
│   ├── js/
│   │   ├── config.js           # ⭐ API keys, AI prompt, ayarlar
│   │   └── api.js              # API çağrıları (Gemini + Yargı)
│   └── css/
│       └── style.css           # Stiller (şu an inline)
│
└── yargi-api/                  # BACKEND
    ├── app.py                  # Flask API
    └── requirements.txt        # Python dependencies
```

---

## 3. Deployment Bilgileri

### Frontend (nevolve)
| Platform | URL | Auto-Deploy |
|----------|-----|-------------|
| Hostinger | http://burhansimsek.space/isthatpossible | ✅ GitHub webhook |
| Netlify | https://verdant-sunflower-fe8596.netlify.app | ✅ GitHub entegre |

### Backend (yargi-api)
| Platform | URL | Auto-Deploy |
|----------|-----|-------------|
| Render | https://yargi-api.onrender.com | ✅ GitHub entegre |

**Not:** Her iki repo'ya push yapınca otomatik deploy olur.

---

## 4. API Bilgileri

### Gemini API (AI)
```
URL: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
Key: AIzaSyDL4rz3oNYEW55VxbLisbAsEAL4g3cKG9U
Model: gemini-2.5-flash
Limit: 20 istek/dakika (free tier)
```

### Yargı API (Backend)
```
Base URL: https://yargi-api.onrender.com
Endpoints:
  GET /search?keyword=xxx     → Karar arama
  GET /document?id=xxx        → Karar içeriği
Source: Bedesten API (Adalet Bakanlığı)
```

### Bedesten API (Kaynak)
```
URL: https://bedesten.adalet.gov.tr/emsal-karar/
Veri: 1.9M+ Yargıtay/Danıştay kararı
```

---

## 5. Önemli Dosyalar

### js/config.js (En Kritik Dosya)
```javascript
const CONFIG = {
    YARGI_API: 'https://yargi-api.onrender.com',
    GEMINI_API: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    GEMINI_KEY: 'AIzaSyDL4rz3oNYEW55VxbLisbAsEAL4g3cKG9U',
    
    AI_SYSTEM_PROMPT: `...`,  // AI'ın nasıl davranacağı
    
    AI_CONFIG: {
        temperature: 0.8,
        maxOutputTokens: 8192
    }
};
```

### app.py (Backend)
- `/search` - Bedesten API'den karar arar
- `/document` - Karar içeriğini getirir (base64 decode)

---

## 6. Bilinen Sorunlar ve Çözümler

### Rate Limit (Gemini)
```
Hata: "Quota exceeded for metric: generate_content_free_tier_requests"
Çözüm: 30 saniye bekle veya paid tier'a geç
```

### Kısa AI Yanıtları
```
Sorun: AI çok kısa yanıt veriyor
Çözüm: 
1. Prompt'ta "EN AZ 1000 KELİME" vurgusu
2. maxOutputTokens: 8192
3. Karar içeriklerini kısalt (token tasarrufu)
```

### CORS Hatası
```
Sorun: Browser'dan API'ye istek atılamıyor
Durum: Gemini API CORS'a izin veriyor, sorun yok
```

---

## 7. Geliştirme Önerileri

### Kısa Vadeli
- [ ] AI prompt optimizasyonu (daha uzun, yapılandırılmış yanıtlar)
- [ ] Markdown → HTML dönüşümü iyileştirme
- [ ] Loading state'leri güzelleştirme
- [ ] Error handling geliştirme

### Orta Vadeli
- [ ] Daha fazla MCP kaynağı entegrasyonu
- [ ] Karar favorileme/kaydetme
- [ ] Arama geçmişi
- [ ] PDF export

### Uzun Vadeli
- [ ] Kullanıcı authentication
- [ ] Dilekçe şablonları
- [ ] Ceza hesaplama araçları
- [ ] Çoklu dil desteği

---

## 8. MCP Kurulumu (Opsiyonel)

Claude Code'da MCP server kurabilirsin:

### Yargı MCP
```bash
# Zaten Bedesten API üzerinden çalışıyor
# Ekstra MCP gerekmez
```

### GitHub MCP (Kod yönetimi için)
```bash
# Claude Code zaten GitHub entegre
# Ekstra kurulum gerekmez
```

### Olası Ek MCP'ler
- **Mevzuat MCP** - Kanun metinleri için
- **UYAP MCP** - (Erişim varsa) dava takibi için

---

## 9. Test Komutları

### Frontend Local Test
```bash
cd nevolve
python -m http.server 8000
# http://localhost:8000 aç
```

### Backend Local Test
```bash
cd yargi-api
pip install flask
python app.py
# http://localhost:5000 aç
```

### API Test (curl)
```bash
# Karar ara
curl "https://yargi-api.onrender.com/search?keyword=dolandırıcılık"

# Karar içeriği
curl "https://yargi-api.onrender.com/document?id=KARAR_ID"
```

---

## 10. Claude Code'da Başlarken

```bash
# Projeyi aç
cd ~/nevolve-project/nevolve

# Claude Code başlat
claude

# İlk komut önerileri:
# "Bu projenin yapısını analiz et"
# "config.js'deki AI prompt'u iyileştir"
# "Daha uzun AI yanıtları için ne yapmalıyız?"
```

---

## 11. İletişim ve Notlar

- **Geliştirici:** Burhan Şimşek
- **Kullanıcılar:** Eymen & Merve (avukatlar)
- **Alan:** Ceza hukuku + İcra hukuku

### Footer Mesajı
```
"evet bu şirket battı, umarım sen batmazsın — 🧑‍🚀 Burhan"
```

### Header Mesajı
```
"ay sonu şok fatura ile karşılaşmamam için linki paylaşma olur mu =)"
```

---

## 12. Hızlı Referans

| Ne Yapacaksın? | Hangi Dosya? |
|----------------|--------------|
| AI davranışını değiştir | `js/config.js` → AI_SYSTEM_PROMPT |
| Arayüz değiştir | `index.html` |
| API endpoint ekle | `yargi-api/app.py` |
| Stil değiştir | `index.html` içindeki `<style>` |

---

## 13. Google Cloud Bilgileri

```
Project: burhansimsekspace
Project ID: gen-lang-client-0430380823
API Key: AIzaSyDL4rz3oNYEW55VxbLisbAsEAL4g3cKG9U
Console: https://console.cloud.google.com
```

---

**Son Güncelleme:** 9 Aralık 2024
**Versiyon:** 1.5.0
