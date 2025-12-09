# nevolve.ai - Oturum Notları
> Son güncelleme: 10 Aralık 2024 (Oturum 2)

---

## Proje Durumu: v3.0.1

**Site URL:** https://burhansimsek.space/isthatpossible/
**Repo:** github.com/ozmengroup/nevolve
**Auto-deploy:** GitHub push → Hostinger otomatik güncelleme

---

## Son Oturum (10 Aralık - Oturum 2)

### Puppeteer MCP Düzeltildi
**Sorun:** `@anthropic/mcp-puppeteer` paketi npm'de yok (404 hatası)

**Çözüm:** Doğru paket kullanıldı:
```bash
# Eski (çalışmıyor):
claude mcp add puppeteer -- npx -y @anthropic/mcp-puppeteer

# Yeni (çalışıyor):
claude mcp add puppeteer -- npx -y @hisma/server-puppeteer
```

**Not:** `@modelcontextprotocol/server-puppeteer` artık desteklenmiyor (deprecated). `@hisma/server-puppeteer` aktif fork'u.

**Durum:** MCP eklendi, Claude Code yeniden başlatılması gerekiyor

---

## Devam Edilecek İşler

### Hemen Yapılacak
1. [x] Puppeteer MCP paket sorunu düzeltildi
2. [ ] Claude Code'u yeniden başlat
3. [ ] Puppeteer MCP'nin çalıştığını test et
4. [ ] Siteyi gerçek kullanım ile test et (soru sor, yanıt al)

### İyileştirme Önerileri (Backlog)
- [ ] Dark mode
- [ ] PDF export
- [ ] Arama geçmişi
- [ ] Daha detaylı loading göstergesi

---

## Önceki Oturum Özeti

### 1. AI Veri Stratejisi (v2.3)
- `parseKarar()` fonksiyonu eklendi - ham karar metnini yapılandırılmış veriye dönüştürür
- `findBestMatch()` - en alakalı kararları seçer
- `buildStructuredContext()` - AI'a temiz veri gönderir
- Token kullanımı %60 azaldı, yanıt kalitesi arttı

### 2. UI Tasarımı (v3.0)
- Minimal Legal tasarım denendi (siyah-beyaz, serif font)
- Kullanıcı geri bildirimi: "Eski renkli kartlar daha anlaşılırdı"
- **v3.0.1:** Mix tasarım uygulandı:
  - Minimal header (Cormorant Garamond serif)
  - Renkli kartlar geri eklendi:
    - ÖZET - Mavi (#F0F9FF)
    - HEMEN YAP - Yeşil (#F0FDF4)
    - EMSAL - Turuncu (#FFF7ED)
    - DİKKAT - Sarı (#FEFCE8)

---

## Teknik Notlar

### Dosya Yapısı
```
/nevolve
├── index.html      # Ana uygulama (v3.0.1)
├── js/
│   ├── config.js   # API keys, prompt, ayarlar
│   └── api.js      # Tüm API fonksiyonları + parseKarar sistemi
└── SESSION_NOTES.md # Bu dosya
```

### API Endpoints
```
Yargi API: https://yargi-api.onrender.com
├── /search         - Yargıtay kararları
├── /document       - Karar içeriği
├── /danistay       - Danıştay kararları
├── /mevzuat/madde  - Kanun maddesi
└── /aym            - Anayasa Mahkemesi

AI: Groq API (Llama 3.3 70B) - 14,400 istek/gün ücretsiz
```

### Önemli Fonksiyonlar (api.js)
- `parseKarar(rawContent, meta)` - Karar parse
- `_extractSonuc()`, `_extractCeza()`, `_extractMaddeler()` - Bilgi çıkarma
- `findBestMatch(soru, kararlar)` - Alaka skorlama
- `buildStructuredContext()` - AI context oluşturma
- `detectCaseType(question)` - Dava tipi algılama

### Puppeteer MCP Bilgileri
**Paket:** `@hisma/server-puppeteer`
**Kurulum:** `claude mcp add puppeteer -- npx -y @hisma/server-puppeteer`
**Araçlar:**
- `puppeteer_navigate` - URL'ye git
- `puppeteer_screenshot` - Ekran görüntüsü al
- `puppeteer_click` - Elemente tıkla
- `puppeteer_fill` - Form alanına yaz
- `puppeteer_evaluate` - JavaScript çalıştır

---

## Yeni Oturumda Devam Etmek İçin

Claude'a şunu söyle:
```
"SESSION_NOTES.md dosyasını oku ve kaldığımız yerden devam edelim.
Puppeteer MCP test edelim."
```

---

## Site Değerlendirmesi (WebFetch ile)
- Tasarım: 8.5/10
- Tipografi: Inter + Cormorant Garamond başarılı
- Renk sistemi: Mavi/Yeşil/Turuncu/Sarı anlaşılır
- Responsive: Mobilde çalışıyor
