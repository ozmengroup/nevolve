// nevolve.ai Main Application
const App = {
    init() {
        this.bindNavigation();
        this.bindAI();
        this.bindSearch();
        this.bindTools();
        this.checkStatus();
        console.log(`${CONFIG.APP_NAME} v${CONFIG.APP_VERSION} initialized`);
    },
    
    // Navigation
    bindNavigation() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
                item.classList.add('active');
                document.getElementById('section-' + item.dataset.section).classList.add('active');
            });
        });
    },
    
    // AI Module
    bindAI() {
        const input = document.getElementById('aiInput');
        const btn = document.getElementById('aiSubmit');
        const response = document.getElementById('aiResponse');
        const content = document.getElementById('aiContent');
        
        btn.addEventListener('click', async () => {
            const question = input.value.trim();
            if (!question) return;
            
            btn.disabled = true;
            btn.textContent = 'Analiz ediliyor...';
            response.classList.add('visible');
            content.innerHTML = '<div class="loading">Yapay zeka analiz ediyor...</div>';
            
            const result = await API.askAI(question);
            content.textContent = result.success ? result.text : 'Hata: ' + result.error;
            
            btn.disabled = false;
            btn.textContent = 'Analiz Et';
        });
        
        // Suggestions
        document.querySelectorAll('#section-ai .tag').forEach(tag => {
            tag.addEventListener('click', () => input.value = tag.dataset.query);
        });
    },
    
    // Search Module
    bindSearch() {
        const input = document.getElementById('searchInput');
        const btn = document.getElementById('searchBtn');
        const loading = document.getElementById('loadingBox');
        const results = document.getElementById('resultsBox');
        const list = document.getElementById('resultsList');
        const count = document.getElementById('resultsCount');
        const docView = document.getElementById('docView');
        const docContent = document.getElementById('docContent');
        
        const doSearch = async () => {
            const query = input.value.trim();
            if (!query) return;
            
            loading.classList.remove('hidden');
            results.classList.add('hidden');
            docView.classList.remove('visible');
            
            const data = await API.searchCases(query);
            loading.classList.add('hidden');
            
            if (data.success) {
                count.textContent = data.total.toLocaleString('tr-TR') + ' sonuç';
                list.innerHTML = data.decisions.map(d => `
                    <div class="result-item" data-id="${d.id}">
                        <div class="result-meta">
                            <span class="result-court">${d.daire}</span>
                            <span class="result-date">${d.tarih}</span>
                        </div>
                        <div class="result-info">Esas: ${d.esasNo} • Karar: ${d.kararNo}</div>
                    </div>
                `).join('');
                results.classList.remove('hidden');
                
                // Bind click events
                list.querySelectorAll('.result-item').forEach(item => {
                    item.addEventListener('click', async () => {
                        list.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
                        item.classList.add('selected');
                        docContent.textContent = 'Yükleniyor...';
                        docView.classList.add('visible');
                        const doc = await API.getDocument(item.dataset.id);
                        docContent.textContent = doc.success ? doc.content : 'Hata';
                    });
                });
            }
        };
        
        btn.addEventListener('click', doSearch);
        input.addEventListener('keydown', e => e.key === 'Enter' && doSearch());
        
        // Suggestions
        document.querySelectorAll('#section-search .tag').forEach(tag => {
            tag.addEventListener('click', () => {
                input.value = tag.dataset.query;
                doSearch();
            });
        });
        
        // Close doc
        document.getElementById('closeDoc')?.addEventListener('click', () => {
            docView.classList.remove('visible');
            list.querySelectorAll('.result-item').forEach(i => i.classList.remove('selected'));
        });
    },
    
    // Tools Module
    bindTools() {
        // Ceza Calculator
        const slider = document.getElementById('cezaSlider');
        const ayDisplay = document.getElementById('cezaAy');
        const sonuc = document.getElementById('cezaSonuc');
        const label = document.getElementById('cezaLabel');
        
        const calculateCeza = () => {
            let ceza = parseInt(slider.value);
            ayDisplay.textContent = ceza;
            let result = ceza;
            document.querySelectorAll('.check-item.active').forEach(item => {
                result *= (1 - parseFloat(item.dataset.rate));
            });
            result = Math.round(result * 10) / 10;
            sonuc.textContent = result.toFixed(1) + ' ay';
            const years = (result / 12).toFixed(1);
            const hagb = result <= 24 ? ' • HAGB uygulanabilir' : '';
            label.textContent = years + ' yıl' + hagb;
        };
        
        slider?.addEventListener('input', calculateCeza);
        document.querySelectorAll('.check-item').forEach(item => {
            item.addEventListener('click', () => {
                item.classList.toggle('active');
                calculateCeza();
            });
        });
        
        // Faiz Calculator
        const anapara = document.getElementById('anapara');
        const faizOran = document.getElementById('faizOran');
        const gunSayisi = document.getElementById('gunSayisi');
        const faizSonuc = document.getElementById('faizSonuc');
        const faizLabel = document.getElementById('faizLabel');
        
        const calculateFaiz = () => {
            const ana = parseInt(anapara.value) || 0;
            const oran = parseFloat(faizOran.value) || 0;
            const gun = parseInt(gunSayisi.value) || 0;
            const faiz = Math.round(ana * (oran / 100) * (gun / 365));
            faizSonuc.textContent = (ana + faiz).toLocaleString('tr-TR') + ' ₺';
            faizLabel.textContent = ana.toLocaleString('tr-TR') + ' ₺ anapara + ' + faiz.toLocaleString('tr-TR') + ' ₺ faiz';
        };
        
        [anapara, faizOran, gunSayisi].forEach(el => el?.addEventListener('input', calculateFaiz));
        
        // Initial calculations
        calculateCeza();
        calculateFaiz();
    },
    
    // Status Check
    async checkStatus() {
        const status = document.getElementById('status');
        const online = await API.checkStatus();
        status.textContent = online ? 'Çevrimiçi' : 'Çevrimdışı';
        status.style.background = online ? 'var(--success-bg)' : '#FEE';
        status.style.color = online ? 'var(--success)' : '#C00';
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());