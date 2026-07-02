        const sessaoString = localStorage.getItem('sinaliza_sessao');
        if (!sessaoString) window.location.href = 'index.html';
        else {
            try { const sessaoData = JSON.parse(sessaoString); } 
            catch(e) { localStorage.removeItem('sinaliza_sessao'); window.location.href = 'index.html'; }
        }

        const API_URL = '/api'; 
        const ITEMS_PER_COLUMN = 6; 
        const ROTATION_TIME = 15000; 

        let ordersData = [];
        let configData = { workflow: [] };
        
        let sectorData = { layout:[], pcp:[], producao:[], faturamento:[] };
        let pageIndices = { layout:0, pcp:0, producao:0, faturamento:0 };

        const SECTORS = [
            { id: 'layout', role: 'layout', label: 'LAYOUT', color: 'var(--col-layout)', icon: 'ph-paint-brush' },
            { id: 'pcp', role: 'pcp', label: 'PCP', color: 'var(--col-pcp)', icon: 'ph-check-square-offset' },
            { id: 'producao', role: 'producao', label: 'PRODUCAO', color: 'var(--col-prod)', icon: 'ph-hammer' },
            { id: 'faturamento', role: 'faturamento', label: 'FATURAMENTO', color: 'var(--col-fat)', icon: 'ph-receipt' }
        ];

        function logout() { localStorage.removeItem('sinaliza_sessao'); window.location.href = 'index.html'; }
        function toggleTheme() {
            const b = document.body; const current = b.getAttribute('data-theme'); const next = current === 'dark' ? 'light' : 'dark';
            b.setAttribute('data-theme', next); localStorage.setItem('theme', next); updateThemeIcon(next);
        }
        function updateThemeIcon(t) { const icon = document.getElementById('theme-icon'); if (icon) icon.className = t === 'dark' ? 'ph-bold ph-sun' : 'ph-bold ph-moon'; }

        async function apiFetch(endpoint) {
            const res = await fetch(`${API_URL}${endpoint}`);
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            return res.json();
        }

        function safeParse(val) { if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return val; } } return val; }
        
        function mapOrder(dbOrder) {
            return {
                id: dbOrder.ID || dbOrder.id,
                client: dbOrder.CLIENTE || dbOrder.client,
                sales: dbOrder.VENDEDOR || dbOrder.sales,
                delivery: dbOrder.DATA_ENTREGA || dbOrder.delivery,
                status: dbOrder.STATUS || dbOrder.status,
                history: safeParse(dbOrder.HISTORY || dbOrder.history) || [],
                created_at: dbOrder.DATA_EMISSAO || dbOrder.created_at, 
                tipo_pedido: dbOrder.TIPO_PEDIDO || dbOrder.tipo_pedido,
                layoutData: safeParse(dbOrder.LAYOUT_DATA || dbOrder.layout_data) || null,
                prodData: safeParse(dbOrder.PROD_DATA || dbOrder.prod_data) || null
            };
        }

        function getGlobalDesigner(o) {
            if (!o.history || o.history.length === 0) return 'N/D';
            const logs = [...o.history].reverse();
            for (const h of logs) {
                const act = String(h.action || '').toLowerCase();
                const obs = String(h.obs || '').toLowerCase();
                const toStep = String(h.to || '').toLowerCase();
                const user = String(h.user || '').trim().toUpperCase();
                
                if (act.includes('finalizad') && toStep.includes('layout')) continue;
                if (act.includes('iniciad') || act.includes('inÃ­cio') || act.includes('inicio') || obs.includes('assumido')) {
                    if (user && !user.includes('SISTEMA')) return user.split(/[\s\u00A0]+/)[0];
                }
                if (act.includes('transfer')) {
                    const match = h.obs.match(/passado para (.*?)\./i);
                    if (match) return match[1].trim().split(/[\s\u00A0]+/)[0].toUpperCase();
                }
                if (act.includes('finalizad') && (toStep.includes('pcp') || toStep.includes('produ') || toStep.includes('fat'))) {
                    if (user && !user.includes('SISTEMA')) return user.split(/[\s\u00A0]+/)[0];
                }
            }
            return 'N/D'; 
        }

        function isRetorno(o) {
            if (!o.history || o.history.length === 0) return false;
            const act = String([...o.history].reverse()[0].action || '').toLowerCase();
            return act.includes('retorno') || act.includes('reprov') || act.includes('devolu');
        }

        // --- A FUNÃ‡ÃƒO MÃGICA RESTAURADA (Bolinhas inteligentes conectadas ao histÃ³rico) ---
        function getLayoutStepsStatus(o) {
            let step = 0; 
            const logs = [...(o.history || [])].reverse();

            for (const h of logs) {
                const act = String(h.action || '').toLowerCase();
                if (act.includes('arte finalizad') || act.includes('projeto finalizad')) { step = 4; break; }
                if (act === 'cliente aprovou') { step = 3; break; }
                if (act === 'enviado ao cliente') { step = 2; break; }
                if (act === 'layout iniciado' || act === 'cliente reprovou' || act.includes('inÃ­cio') || act.includes('inicio')) { step = 1; break; }
            }

            if (step === 0) {
                const designerName = getGlobalDesigner(o);
                if (designerName && designerName !== 'N/D') {
                    step = 1; // Se assumiu, liga a bolinha 2 (Iniciado)
                }
            }

            return [
                step >= 0, // Fila
                step >= 1, // Iniciado
                step >= 2, // No Cliente
                step >= 3, // Aprovado
                step >= 4  // Finalizado
            ];
        }

        window.onload = async () => {
            startClock();
            const t = localStorage.getItem('theme') || 'light'; 
            document.body.setAttribute('data-theme', t); updateThemeIcon(t);

            await loadConfig();
            await loadData();
            setInterval(async () => { await loadData(); }, 30000); 
            setInterval(() => { rotatePages(); renderColumns(); }, ROTATION_TIME);
        };

        function startClock() {
            const update = () => {
                const now = new Date();
                document.getElementById('clock-time').innerText = now.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
                document.getElementById('clock-date').innerText = now.toLocaleDateString('pt-BR', {weekday:'long', day:'2-digit', month:'long'}).toUpperCase().replace('-FEIRA', '');
            };
            update(); setInterval(update, 1000);
        }

        async function loadConfig() { 
            try { 
                const wf = await apiFetch('/config/workflow');
                if(wf && wf.dados) { 
                    let wData = wf.dados; 
                    if(typeof wData === 'string') wData = JSON.parse(wData); 
                    configData.workflow = wData; 
                } 
            } catch(e){} 
        }

        async function loadData() { 
            const statusBadge = document.getElementById('conn-status');
            try {
                statusBadge.innerHTML = '<i class="ph-bold ph-arrows-clockwise ph-spin"></i> Atualizando';
                statusBadge.className = 'connection-status';
                statusBadge.style.color = 'var(--warning)'; statusBadge.style.borderColor = 'var(--warning-border)'; statusBadge.style.background = 'var(--warning-bg)';
                
                const rawData = await apiFetch('/pedidos'); 
                
                statusBadge.innerHTML = '<i class="ph-bold ph-wifi-high"></i> Online';
                statusBadge.className = 'connection-status online';
                statusBadge.style = '';

                if(rawData) { 
                    ordersData = rawData.map(mapOrder); 
                    processData();
                    renderColumns();
                } 
            } catch(e){
                statusBadge.innerHTML = '<i class="ph-bold ph-warning-circle"></i> Offline';
                statusBadge.className = 'connection-status offline';
                statusBadge.style = '';
            } 
        }

        function processData() {
            sectorData = { layout:[], pcp:[], producao:[], faturamento:[] };
            let total = 0, late = 0, done = 0, warningCount = 0, returnCount = 0;
            const finalStage = configData.workflow.length > 0 ? configData.workflow[configData.workflow.length-1].name : 'Finalizado';
            const todayStr = new Date().toISOString().split('T')[0];

            ordersData.forEach(o => {
                if (o.status === finalStage || o.status === 'Finalizado') {
                    const last = o.history && o.history.length > 0 ? o.history[o.history.length-1] : null;
                    if (last && last.date && last.date.startsWith(todayStr)) done++;
                    return; 
                }

                const stepInfo = configData.workflow.find(s => s.name === o.status);
                const isFaturamento = (o.status.toLowerCase() === 'faturamento' || o.status.toLowerCase() === 'em faturamento');
                const roleKey = isFaturamento ? 'faturamento' : (stepInfo && stepInfo.role ? stepInfo.role.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : null);
                
                if (roleKey && sectorData[roleKey] !== undefined) {
                    sectorData[roleKey].push(o);
                    total++;
                    if(isRetorno(o)) returnCount++;

                    let slaInfo = { status: 'normal' };
                    try {
                        let ext = [];
                        if (roleKey === 'producao' && o.prodData && o.prodData.extensions) ext = o.prodData.extensions;
                        else if (roleKey === 'layout' && o.layoutData && o.layoutData.extensions) ext = o.layoutData.extensions;
                        slaInfo = SinalizaCore.calculateSLA(o, ext) || slaInfo;
                    } catch(e){}

                    if (slaInfo.status === 'late') late++;
                    else if (slaInfo.status === 'warning') warningCount++;
                }
            });

            Object.keys(sectorData).forEach(k => {
                sectorData[k].sort((a,b) => {
                    const retA = isRetorno(a); const retB = isRetorno(b);
                    if (retA !== retB) return retA ? -1 : 1;

                    let sA = { status: 'normal', dateStr: '9999-12-31' }; let sB = { status: 'normal', dateStr: '9999-12-31' };
                    try { sA = SinalizaCore.calculateSLA(a, k==='producao'?a.prodData?.extensions:k==='layout'?a.layoutData?.extensions:[]) || sA; } catch(e){}
                    try { sB = SinalizaCore.calculateSLA(b, k==='producao'?b.prodData?.extensions:k==='layout'?b.layoutData?.extensions:[]) || sB; } catch(e){}

                    if (sA.status === 'late' && sB.status !== 'late') return -1;
                    if (sA.status !== 'late' && sB.status === 'late') return 1;
                    if (sA.status === 'warning' && sB.status !== 'warning') return -1;
                    if (sA.status !== 'warning' && sB.status === 'warning') return 1;

                    return new Date(sA.dateStr) - new Date(sB.dateStr);
                });
            });

            document.getElementById('stat-total').innerText = total;
            document.getElementById('stat-late').innerText = late;
            document.getElementById('stat-warning').innerText = warningCount;
            document.getElementById('stat-done').innerText = done;
            document.getElementById('stat-returns').innerText = returnCount;
        }

        function createBoard() {
            const container = document.getElementById('board-container');
            if (container.children.length !== 4) {
                container.innerHTML = SECTORS.map(sec => `
                    <div class="column" style="--col-color: ${sec.color}">
                        <div class="col-header">
                            <div class="col-title-area">
                                <div class="col-icon"><i class="ph-bold ${sec.icon}"></i></div>
                                <span class="col-title">${sec.label}</span>
                            </div>
                            <div class="col-stats">
                                <span class="col-page" id="pg-${sec.id}"></span>
                                <span class="col-count" id="cnt-${sec.id}">0</span>
                            </div>
                        </div>
                        <div class="col-body" id="lst-${sec.id}"></div>
                    </div>
                `).join('');
            }
        }

        function rotatePages() {
            SECTORS.forEach(sec => {
                const total = sectorData[sec.id].length;
                const pages = Math.ceil(total / ITEMS_PER_COLUMN);
                if (pages > 1) {
                    pageIndices[sec.id]++;
                    if (pageIndices[sec.id] >= pages) pageIndices[sec.id] = 0;
                } else {
                    pageIndices[sec.id] = 0;
                }
            });
        }

        function renderColumns() {
            createBoard();

            SECTORS.forEach(sec => {
                const listEl = document.getElementById(`lst-${sec.id}`);
                const countEl = document.getElementById(`cnt-${sec.id}`);
                const pgEl = document.getElementById(`pg-${sec.id}`);
                
                if(!listEl) return;
                const items = sectorData[sec.id];
                
                if (items.length === 0) {
                    countEl.innerText = '0'; pgEl.innerText = '';
                    listEl.innerHTML = `<div class="card card-empty fade-enter" style="grid-row: span 6;"><i class="ph-bold ph-check-circle"></i><span>Fila Limpa</span></div>`;
                    return; 
                }

                countEl.innerText = items.length;
                const totalPages = Math.ceil(items.length / ITEMS_PER_COLUMN);
                if (pageIndices[sec.id] >= totalPages) pageIndices[sec.id] = 0;
                
                const start = pageIndices[sec.id] * ITEMS_PER_COLUMN;
                const pageItems = items.slice(start, start + ITEMS_PER_COLUMN);
                pgEl.innerText = totalPages > 1 ? `${pageIndices[sec.id] + 1} / ${totalPages}` : '';

                let animDelay = 0;

                listEl.innerHTML = pageItems.map(o => {
                    let slaInfo = { status: 'normal', displayDate: '--/--' };
                    try {
                        let ext = [];
                        if (sec.id === 'producao' && o.prodData && o.prodData.extensions) ext = o.prodData.extensions;
                        else if (sec.id === 'layout' && o.layoutData && o.layoutData.extensions) ext = o.layoutData.extensions;
                        slaInfo = SinalizaCore.calculateSLA(o, ext) || slaInfo;
                    } catch(e){}

                    const isLate = slaInfo.status === 'late';
                    const isWarning = slaInfo.status === 'warning';
                    const ehRetorno = isRetorno(o);
                    const clientName = o.client ? o.client : 'N/D';
                    
                    let tp = String(o.tipo_pedido || '').toLowerCase().trim();
                    let iconTag = '';
                    if (tp === 'homologado') iconTag = '<div class="tag-icon tag-homologado" title="Homologado"><i class="ph-fill ph-star"></i></div>';
                    else if (tp === 'projeto') iconTag = '<div class="tag-icon tag-projeto" title="Projeto"><i class="ph-fill ph-blueprint"></i></div>';

                    // Aqui a MÃGICA acontece e insere as bolinhas no cÃ³digo!
                    let dotsHtml = '';
                    if (sec.id === 'layout') {
                        const stepsStatus = getLayoutStepsStatus(o); 
                        dotsHtml = `<div class="steps-indicator" title="Progresso Interno do Setor">
                            ${stepsStatus.map(isDone => isDone 
                                ? '<div class="step-dot done"><i class="ph-bold ph-check"></i></div>' 
                                : '<div class="step-dot"></div>'
                            ).join('')}
                        </div>`;
                    }

                    let cardStateClass = '';
                    let pillHtml = '';

                    if (ehRetorno) {
                        cardStateClass = 'return';
                        pillHtml = `<div class="date-pill"><i class="ph-fill ph-warning-octagon"></i> RETORNO</div>`;
                    } else if (isLate) {
                        cardStateClass = 'late';
                        pillHtml = `<div class="date-pill"><i class="ph-bold ph-calendar-blank"></i> ${slaInfo.displayDate} <div class="pill-dot"></div></div>`;
                    } else if (isWarning) {
                        cardStateClass = 'warning';
                        pillHtml = `<div class="date-pill"><i class="ph-bold ph-calendar-blank"></i> ${slaInfo.displayDate} <div class="pill-dot"></div></div>`;
                    } else {
                        pillHtml = `<div class="date-pill"><i class="ph-bold ph-calendar-blank"></i> ${slaInfo.displayDate}</div>`;
                    }

                    const salesName = o.sales ? String(o.sales).trim().split(/[\s\u00A0]+/)[0].toUpperCase() : 'N/D';
                    const designerName = getGlobalDesigner(o);
                    const currentDelay = animDelay; animDelay += 0.05; 

                    return `
                    <div class="card fade-enter ${cardStateClass}" style="animation-delay: ${currentDelay}s">
                        <div class="card-top">
                            <span class="card-id">#${o.id} ${iconTag}</span>
                            ${pillHtml}
                        </div>
                        <div class="card-client" title="${clientName}">${clientName}</div>
                        
                        <div class="card-sub">
                            <div class="info-wrapper">
                                <span class="info-pill" title="Vendedor"><i class="ph-fill ph-briefcase"></i> ${salesName}</span>
                                <span class="info-pill" title="ResponsÃ¡vel"><i class="ph-fill ph-user"></i> ${designerName}</span>
                            </div>
                            ${dotsHtml}
                        </div>
                    </div>`;
                }).join('');
            });
        }
