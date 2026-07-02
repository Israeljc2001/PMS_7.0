// ====================================================
        // 🔒 BLOQUEIO DE SEGURANÇA E SESSÃO
        // ====================================================
        const sessaoString = localStorage.getItem('sinaliza_sessao');
        let currentUser = null;
        let currentRole = null;

        if (!sessaoString) {
            window.location.href = 'index.html';
        } else {
            try {
                const sessaoData = JSON.parse(sessaoString);
                currentUser = sessaoData.username;
                currentRole = sessaoData.role;
            } catch(e) {
                localStorage.removeItem('sinaliza_sessao');
                window.location.href = 'index.html';
            }
        }

// ====================================================
        // 1. CONFIGURAÇÃO DA API
        // ====================================================
        const API_URL = '/api';

        let ordersData = [];
        let configData = { workflow: [] };
        
        let layoutSelectedFiles = [];
        let resendSelectedFiles = []; 
        
        const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
        let salesChart, paymentChart, clientsChart, statusChart, dailyChart, calendar;

        window.onload = async () => {
            loadTheme();
            
            if(currentUser) {
                const displayUser = String(currentUser).trim().toUpperCase();

                const sidebarUserName = document.getElementById('user-name');
                if (sidebarUserName) sidebarUserName.innerText = displayUser;

                const pageUserName = document.getElementById('page-user-name');
                if (pageUserName) pageUserName.innerText = displayUser;

                const topbarUserName = document.getElementById('topbar-user-name');
                if (topbarUserName) topbarUserName.innerText = displayUser;
            }

            await loadConfig();
            await loadData();
            initCalendar();
            
            // Add loadSavedData hook for tools
            loadSavedData();
            
            setInterval(loadData, 60000); 
        };

        function logout() {
            localStorage.removeItem('sinaliza_sessao'); 
            window.location.href = 'index.html';        
        }

        async function apiFetch(endpoint, method = 'GET', body = null) {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) options.body = JSON.stringify(body);
            
            const res = await fetch(`${API_URL}${endpoint}`, options);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || err.message || `Erro HTTP: ${res.status}`);
            }
            return res.json();
        }

        function safeParse(val) {
            if (typeof val === 'string') {
                try { return JSON.parse(val); } catch (e) { return val; }
            }
            return val;
        }

        function mapOrder(dbOrder) {
            return {
                id: dbOrder.ID || dbOrder.id,
                client: dbOrder.CLIENTE || dbOrder.client,
                sales: dbOrder.VENDEDOR || dbOrder.sales,
                value: dbOrder.VALOR !== undefined ? dbOrder.VALOR : dbOrder.value,
                delivery: dbOrder.DATA_ENTREGA || dbOrder.delivery,
                status: dbOrder.STATUS || dbOrder.status,
                contact: dbOrder.CONTATO || dbOrder.contact,
                email: dbOrder.EMAIL || dbOrder.email,
                obs: dbOrder.OBS || dbOrder.obs,
                payment: dbOrder.PAGAMENTO || dbOrder.payment,
                shipping: dbOrder.FRETE || dbOrder.shipping,
                issue_date: dbOrder.DATA_EMISSAO || dbOrder.issue_date,
                history: safeParse(dbOrder.HISTORY || dbOrder.history) || [],
                files: safeParse(dbOrder.FILES || dbOrder.files) || [],
                layoutData: safeParse(dbOrder.LAYOUT_DATA || dbOrder.layout_data) || null,
                prodData: safeParse(dbOrder.PROD_DATA || dbOrder.prod_data) || null,
                created_at: dbOrder.CREATED_AT || dbOrder.created_at,
                tipo_pedido: dbOrder.TIPO_PEDIDO || dbOrder.tipo_pedido,
                _raw: dbOrder
            };
        }

        function getSafeStatus(val) { return String(val || '').trim().toLowerCase(); }

        function getStatusRealPedido(o) {
            let status = getSafeStatus(o.status);
            const history = Array.isArray(o.history) ? o.history : [];

            if (history.length > 0) {
                const lastLog = history[history.length - 1];
                if (lastLog && lastLog.to) status = getSafeStatus(lastLog.to);
            }

            return status;
        }

        function isStatusComercialPendente(status) {
            const statusSafe = getSafeStatus(status);
            const comercialSteps = configData.workflow
                .filter(w => getSafeStatus(w.role) === 'comercial')
                .map(w => getSafeStatus(w.name));

            if (comercialSteps.length > 0) return comercialSteps.includes(statusSafe);

            const stepComercial = configData.workflow.length > 0 ? getSafeStatus(configData.workflow[0].name) : 'comercial';
            return statusSafe === stepComercial ||
                statusSafe === 'novo pedido' ||
                statusSafe === 'aguardando comercial' ||
                statusSafe === 'retorno comercial' ||
                statusSafe === 'pendente comercial';
        }

        // ====================================================
        // FUNÇÕES CRUD CORE
        // ====================================================
        async function loadConfig() { 
            try { 
                const wf = await apiFetch('/config/workflow');
                if(wf && wf.dados) {
                    let wData = wf.dados;
                    if(typeof wData === 'string') wData = JSON.parse(wData);
                    configData.workflow = wData.map(w => ({ name: w.name, role: w.role || w.sector || 'admin' }));
                } else { configData.workflow = []; }
            } catch(e){ console.log("Workflow default carregado"); } 
        }

        async function loadData() { 
            const statusBadge = document.getElementById('db-status-badge');
            const statusText = document.getElementById('db-status-text');
            const lastUpdateText = document.getElementById('last-update-text');

            try {
                statusBadge.className = 'status-badge-top syncing';
                statusText.innerHTML = 'Sincronizando... <i class="ph-bold ph-spinner ph-spin"></i>';

                const rawData = await apiFetch('/pedidos'); 

                statusBadge.className = 'status-badge-top online';
                statusText.innerHTML = 'Conectado';
                
                const now = new Date();
                lastUpdateText.innerText = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                if(rawData) { 
                    ordersData = rawData.map(mapOrder); 
                    populateSalesFilters();
                    
                    if(!document.getElementById('view-action').classList.contains('hidden')) renderActionOrders(); 
                    if(!document.getElementById('view-monitor').classList.contains('hidden')) renderMonitorOrders();
                    if(!document.getElementById('view-dash').classList.contains('hidden')) { updateKPIs(); renderChart(); renderAnalytics(); updateCalendarEvents(); }
                } 
            } catch(e){
                console.error("Erro Conexão", e);
                statusBadge.className = 'status-badge-top offline';
                statusText.innerHTML = 'Falha de Conexão';
            } 
        }

        async function sync() { 
            try { 
                await SinalizaCore.triggerVPNSync(); 
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Agente sincronizado!', showConfirmButton: false, timer: 3000 }); 
            } catch(e){} 
            loadData(); 
        }

        function isOwner(orderSalesName) { 
            if(currentRole === 'admin') return true; 
            return orderSalesName && currentUser && orderSalesName.toLowerCase().includes(currentUser.toLowerCase()); 
        }

        function populateSalesFilters() {
            const sellers = [...new Set(ordersData.map(o => o.sales ? o.sales.trim() : 'N/D'))].sort();
            let html = `<option value="all">🌐 Toda a Equipe</option><option value="${currentUser}">👤 Apenas os meus</option>`;
            sellers.forEach(s => { if(s && s !== 'N/D' && !s.toLowerCase().includes((currentUser||'').toLowerCase())) html += `<option value="${s}">${s}</option>`; });
            
            const selMon = document.getElementById('filter-salesperson-monitor'); 
            if(selMon && !selMon.value) selMon.innerHTML = html; else if(selMon) { const val = selMon.value; selMon.innerHTML = html; selMon.value = val; }
            
            const selAct = document.getElementById('filter-salesperson-action'); 
            if(selAct && !selAct.value) selAct.innerHTML = html; else if(selAct) { const val = selAct.value; selAct.innerHTML = html; selAct.value = val; }
        }

        function switchView(v) { 
            const targetView = (v === 'rastreio') ? 'transportadoras' : v;

            ['dash', 'action', 'monitor', 'tools', 'transportadoras', 'portais', 'normas', 'galeria'].forEach(viewName => {
                const view = document.getElementById('view-' + viewName);
                if (view) view.classList.add('hidden');
            });

            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active')); 

            const target = document.getElementById('view-' + targetView);
            if (target) target.classList.remove('hidden'); 

            const activeBtn = document.getElementById('btn-' + targetView);
            if (activeBtn) activeBtn.classList.add('active');

            if(targetView === 'dash') { updateKPIs(); renderChart(); renderAnalytics(); if(calendar) setTimeout(() => calendar.render(), 200); }
            if(targetView === 'action') renderActionOrders();
            if(targetView === 'monitor') renderMonitorOrders();
        }

        window.toggleCard = function(id) {
            const row = document.getElementById(`row-${id}`);
            if (!row) return;
            const wasExpanded = row.classList.contains('is-expanded');
            document.querySelectorAll('.list-row.is-expanded').forEach(c => c.classList.remove('is-expanded'));
            if (!wasExpanded) row.classList.add('is-expanded');
        };

        function isOrderReturned(o) {
            const hist = o.history || [];
            if (hist.length === 0) return false;
            const lastEntry = hist[hist.length - 1];
            const actionStr = (lastEntry.action || '').toLowerCase();
            const toStr = getSafeStatus(lastEntry.to);
            const stepComercial = configData.workflow.length > 0 ? getSafeStatus(configData.workflow[0].name) : 'comercial';
            return actionStr.includes('retorno') || actionStr.includes('devolu') || actionStr.includes('reprova') || toStr === stepComercial;
        }

        function escapeHTML(value = '') {
            return String(value)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function toDateInputValue(value) {
            if (!value || value === '9999-12-31') return '';
            const dateStr = String(value).trim();
            if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.substring(0, 10);
            if (/^\d{2}\/\d{2}\/\d{4}/.test(dateStr)) {
                const parts = dateStr.substring(0, 10).split('/');
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            const parsed = new Date(dateStr);
            if (isNaN(parsed.getTime())) return '';
            return parsed.toISOString().split('T')[0];
        }

        function formatDateBR(value) {
            const dateInput = toDateInputValue(value);
            if (!dateInput) return '--';
            return dateInput.split('-').reverse().join('/');
        }

        function getDateChangeReasonLabel(value) {
            const labels = {
                retorno_comercial: 'Retorno ao Comercial',
                aguardando_cliente: 'Aguardando cliente',
                ajuste_prazo: 'Ajuste de prazo',
                correcao_data: 'Correcao de data',
                outros: 'Outros'
            };
            return labels[value] || value || '';
        }

        function wasDateChangedByComercial(o) {
            const hist = Array.isArray(o.history) ? o.history : [];
            return hist.some(h => String(h.action || '').toLowerCase().includes('data/prazo alterado pelo comercial'));
        }

        // ==========================================
        // 🚀 ABA 1: FILA DE AÇÃO
        // ==========================================
        function renderActionOrders() {
            const container = document.getElementById('orders-container-action');
            const searchTerm = document.getElementById('search-input-action').value.toLowerCase();
            const badge = document.getElementById('return-badge');
            
            const filterSales = document.getElementById('filter-salesperson-action').value || 'all';
            
            let actionOrders = ordersData.filter(o => isStatusComercialPendente(getStatusRealPedido(o)));

            if (filterSales !== 'all') { actionOrders = actionOrders.filter(o => filterSales === currentUser ? isOwner(o.sales) : (o.sales && o.sales === filterSales)); }
            if (searchTerm) { actionOrders = actionOrders.filter(o => String(o.id).includes(searchTerm) || (o.client && o.client.toLowerCase().includes(searchTerm))); }

            const devolvidos = actionOrders.filter(o => isOrderReturned(o)).length;

            badge.innerText = devolvidos;
            badge.style.display = devolvidos > 0 ? 'inline-block' : 'none';

            if(actionOrders.length === 0) { container.innerHTML='<div style="text-align:center; padding:80px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda); box-shadow:var(--sombra-sm);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Fila Limpa!</strong><br>Nenhuma ação pendente.</div>'; return; }

            actionOrders.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
            container.innerHTML = actionOrders.map(o => createActionRowHTML(o)).join('');
        }

        function createActionRowHTML(o) {
            const hist = o.history || [];
            const isReturned = isOrderReturned(o);
            
            let cardClass = isReturned ? 'late' : 'new';
            let statusBadge = isReturned 
                ? `<span class="status-pill" style="background:var(--danger-bg); color:var(--cor-erro);" onclick="event.stopPropagation(); openHistoryModal('${o.id}')" title="Ver Histórico">DEVOLVIDO <i class="ph-bold ph-clock-counter-clockwise" style="margin-left:4px;"></i></span>`
                : `<span class="status-pill" style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria);" onclick="event.stopPropagation(); openHistoryModal('${o.id}')" title="Ver Histórico">NOVO PEDIDO <i class="ph-bold ph-clock-counter-clockwise" style="margin-left:4px;"></i></span>`;

            let obsDevolucao = '';
            if (isReturned) {
                const motivoDev = hist.length > 0 ? hist[hist.length-1].obs || 'Sem justificativa.' : 'N/A';
                obsDevolucao = `<div style="background:var(--danger-bg); color:var(--cor-erro); border:1px solid rgba(239, 68, 68, 0.2); padding:15px; border-radius:var(--radius-padrao); font-size:0.9rem; margin-bottom:15px;">
                                    <strong style="display:flex; align-items:center; gap:6px; margin-bottom:4px; font-size:0.9rem;"><i class="ph-fill ph-warning-circle" style="font-size:1.1rem;"></i> Motivo do Retorno:</strong>
                                    ${motivoDev}
                                </div>`;
            }

            let rawDelivery = o.delivery;
            if(rawDelivery && typeof rawDelivery === 'string' && rawDelivery.includes('T')) rawDelivery = rawDelivery.split('T')[0];
            const prazoDisplay = formatDateBR(rawDelivery);
            const dateUpdatedPill = wasDateChangedByComercial(o)
                ? '<span class="comercial-date-updated"><i class="ph-fill ph-calendar-check"></i> Prazo atualizado pelo Comercial</span>'
                : '';

            let safeClient = escapeHTML(o.client || '');

            return `
            <div class="list-row ${cardClass} ${isReturned ? 'is-retorno' : ''}" id="row-${o.id}">
                <div class="row-header order-card-main" onclick="toggleCard('${o.id}')">
                    <div>
                        <div class="order-id-line">
                            <span class="id-badge">#${o.id}</span>
                            ${statusBadge}
                            ${isReturned ? '<span class="status-pill" style="background:var(--warning-bg); color:var(--cor-alerta);"><i class="ph-fill ph-warning"></i> Atenção</span>' : ''}
                        </div>
                        <div class="client-name" title="${safeClient}">${safeClient || 'N/D'}</div>
                        <div class="order-meta">
                            <span><i class="ph-fill ph-user-circle"></i> ${o.sales || 'N/D'}</span>
                            <span><i class="ph-bold ph-calendar-blank"></i> ${o.issue_date ? o.issue_date.split('-').reverse().join('/') : '--'}</span>
                        </div>
                    </div>

                    <div class="order-field"><span>Responsável</span><strong>${o.sales || 'N/D'}</strong></div>
                    <div class="order-field"><span>Prazo</span><strong>${prazoDisplay}</strong>${dateUpdatedPill}</div>
                    <div class="order-field"><span>Valor</span><strong class="money-val">${o.value ? moneyFmt.format(parseFloat(o.value)) : 'N/D'}</strong></div>

                    <div class="order-actions">
                        <button class="btn btn-secondary comercial-date-btn" onclick="event.stopPropagation(); openEditDateModal('${o.id}', '${rawDelivery || ''}')"><i class="ph-bold ph-calendar-plus"></i> Alterar Prazo</button>
                        ${isReturned 
                            ? `<button class="btn btn-danger" onclick="event.stopPropagation(); openResendModal('${o.id}')"><i class="ph-bold ph-arrow-u-up-right"></i> Corrigir</button>` 
                            : `<button class="btn btn-primary" onclick="event.stopPropagation(); openBriefingModal('${o.id}', '${rawDelivery || ''}')"><i class="ph-bold ph-paper-plane-right"></i> Briefing</button>`
                        }
                        <button class="btn-act" onclick="event.stopPropagation(); toggleCard('${o.id}')" title="Expandir pedido"><i class="ph-bold ph-caret-down"></i></button>
                    </div>
                </div>
                
                <div class="card-details" onclick="event.stopPropagation()">
                    ${isReturned ? `<div class="return-note"><strong><i class="ph-fill ph-warning-circle"></i> Motivo do Retorno:</strong><br>${hist.length > 0 ? hist[hist.length-1].obs || 'Sem justificativa.' : 'N/A'}</div>` : ''}
                    <div class="details-grid">
                        <div class="info-panel">
                            <div class="info-panel-title"><i class="ph-fill ph-file-text"></i> Informações de Importação (ERP)</div>
                            <div class="detail-kv">
                                <div><span>Contato</span><strong>${o.contact || 'N/D'}</strong></div>
                                <div><span>E-mail</span><strong>${o.email || 'N/D'}</strong></div>
                                <div><span>Pagamento</span><strong>${o.payment || 'N/D'}</strong></div>
                                <div><span>Frete</span><strong>${o.shipping || 'N/D'}</strong></div>
                            </div>
                        </div>
                        <div class="info-panel">
                            <div class="info-panel-title"><i class="ph-fill ph-lightning"></i> Ações do Pedido</div>
                            <div style="display:flex; flex-direction:column; gap:10px;">
                                <button class="btn btn-secondary comercial-date-btn" onclick="openEditDateModal('${o.id}', '${rawDelivery || ''}')"><i class="ph-bold ph-calendar-plus"></i> Alterar Prazo</button>
                                <button class="btn btn-secondary" onclick="openFilesModal('${o.id}')"><i class="ph-bold ph-folder-open"></i> Ficheiros Físicos</button>
                                ${isReturned 
                                    ? `<button class="btn btn-danger" onclick="openResendModal('${o.id}')"><i class="ph-bold ph-arrow-u-up-right"></i> Corrigir e Reenviar</button>` 
                                    : `<button class="btn btn-primary" onclick="openBriefingModal('${o.id}', '${rawDelivery || ''}')"><i class="ph-bold ph-paper-plane-right"></i> Iniciar Briefing</button>`
                                }
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;

            return `
            <div class="list-row ${cardClass}" id="row-${o.id}">
                <div class="row-header" onclick="toggleCard('${o.id}')" style="display: flex; align-items: center; width: 100%; gap: 20px;">
                    
                    <div style="width: 80px; flex-shrink: 0;">
                        <span class="id-badge">#${o.id}</span>
                    </div>
                    
                    <div style="flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 4px;">
                        <div class="client-name" title="${safeClient}" style="font-size: 1rem; line-height: 1.2;">${safeClient || 'N/D'}</div>
                        ${isReturned ? '<span style="color:var(--cor-erro); font-size:0.7rem; font-weight:700;"><i class="ph-fill ph-warning"></i> Requer Atenção</span>' : ''}
                    </div>
                    
                    <div style="width: 160px; color:var(--cor-texto-mutado); font-size: 0.85rem; display:flex; align-items:center; gap:6px; font-weight: 500;">
                        <i class="ph-fill ph-user-circle" style="font-size: 1.2rem;"></i> ${o.sales || 'N/D'}
                    </div>
                    
                    <div style="width: 150px; color:var(--cor-texto-mutado); font-size: 0.85rem; display:flex; align-items:center; gap:6px; font-weight: 500;">
                        <i class="ph-bold ph-calendar-blank" style="font-size: 1.2rem;"></i> ${o.issue_date ? o.issue_date.split('-').reverse().join('/') : '--'}
                    </div>
                    
                    <div style="width: 160px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
                        ${statusBadge}
                        <div style="color:var(--cor-texto-mutado); font-size:0.75rem; font-weight:600; display:flex; align-items:center; gap:4px;">
                            Expandir <i class="ph-bold ph-caret-down"></i>
                        </div>
                    </div>

                </div>
                
                <div class="card-details" onclick="event.stopPropagation()">
                    ${obsDevolucao}
                    <div class="info-panel" style="margin-bottom:15px;">
                        <div class="info-panel-title"><i class="ph-fill ph-file-text" style="font-size:1.1rem;"></i> Informações de Importação (ERP)</div>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; font-size:0.85rem; color:var(--cor-texto);">
                            <div><strong style="color:var(--cor-texto-mutado);">Contato:</strong> <span style="font-weight:600;">${o.contact || 'N/D'}</span></div>
                            <div><strong style="color:var(--cor-texto-mutado);">E-mail:</strong> <span style="font-weight:600;">${o.email || 'N/D'}</span></div>
                            <div><strong style="color:var(--cor-texto-mutado);">Pagamento:</strong> <span style="font-weight:600;">${o.payment || 'N/D'}</span></div>
                            <div><strong style="color:var(--cor-texto-mutado);">Frete:</strong> <span style="font-weight:600;">${o.shipping || 'N/D'}</span></div>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                        <div style="font-size:0.9rem; font-weight:700; color:var(--cor-texto); display:flex; align-items:center; gap:6px; background:var(--cor-card-bg); padding:8px 12px; border-radius:var(--radius-padrao); border:1px solid var(--cor-borda);"><i class="ph-fill ph-currency-dollar" style="font-size:1.2rem; color:var(--cor-sucesso);"></i> Valor do Projeto: <span style="color:var(--cor-sucesso);">${o.value ? moneyFmt.format(parseFloat(o.value)) : 'N/D'}</span></div>
                        <div style="display:flex; gap:10px; align-items:center; flex-wrap: wrap;">
                            <button class="btn btn-secondary" onclick="openFilesModal('${o.id}')"><i class="ph-bold ph-folder-open" style="font-size:1.1rem;"></i> Ficheiros Físicos</button>
                            ${isReturned 
                                ? `<button class="btn btn-danger" onclick="openResendModal('${o.id}')"><i class="ph-bold ph-arrow-u-up-right" style="font-size:1.1rem;"></i> Corrigir e Reenviar</button>` 
                                : `<button class="btn btn-primary" onclick="openBriefingModal('${o.id}', '${rawDelivery || ''}')"><i class="ph-bold ph-paper-plane-right" style="font-size:1.1rem;"></i> Iniciar Briefing</button>`
                            }
                        </div>
                    </div>
                </div>
            </div>`;
        }

        // ==========================================
        // 🚀 ABA 2: MONITORAMENTO (STEPPER COM DATAS)
        // ==========================================
        function renderMonitorOrders() {
            const container = document.getElementById('orders-container-monitor');
            const kpiContainer = document.getElementById('kpi-container-monitor');
            const searchTerm = document.getElementById('search-input-monitor').value.toLowerCase();
            const filterStatus = document.getElementById('filter-status-monitor').value;
            const filterSales = document.getElementById('filter-salesperson-monitor').value || 'all';
            
            const stepComercial = configData.workflow.length > 0 ? getSafeStatus(configData.workflow[0].name) : 'comercial';
            const finalStage = configData.workflow.length > 0 ? getSafeStatus(configData.workflow[configData.workflow.length-1].name) : 'finalizado';
            let monitorOrders = ordersData.filter(o => getSafeStatus(o.status) !== stepComercial && getSafeStatus(o.status) !== finalStage);

            if (searchTerm) { monitorOrders = monitorOrders.filter(o => String(o.id).includes(searchTerm) || (o.client && o.client.toLowerCase().includes(searchTerm))); }
            if (filterStatus !== 'all') { monitorOrders = monitorOrders.filter(o => getSafeStatus(o.status) === getSafeStatus(filterStatus)); }
            if (filterSales !== 'all') { monitorOrders = monitorOrders.filter(o => filterSales === currentUser ? isOwner(o.sales) : (o.sales && o.sales === filterSales)); }

            const emLayout = monitorOrders.filter(o => getSafeStatus(o.status) === 'em layout').length;
            const noPcp = monitorOrders.filter(o => getSafeStatus(o.status) === 'pcp revisão' || getSafeStatus(o.status) === 'pcp').length;
            const naProd = monitorOrders.filter(o => getSafeStatus(o.status) === 'em produção' || getSafeStatus(o.status) === 'produção').length;

            if (kpiContainer) {
                kpiContainer.innerHTML = `
                <div class="kpi-card" onclick="document.getElementById('filter-status-monitor').value='Em Layout'; renderMonitorOrders()"><div style="display:flex; align-items:center; gap:15px;"><div class="kpi-icon" style="background:#EDE9FE; color:#8B5CF6;"><i class="ph-fill ph-paint-brush"></i></div><div><span class="kpi-label">No Layout</span><div class="kpi-val" style="color:#8B5CF6">${emLayout}</div></div></div></div>
                <div class="kpi-card" onclick="document.getElementById('filter-status-monitor').value='PCP Revisão'; renderMonitorOrders()"><div style="display:flex; align-items:center; gap:15px;"><div class="kpi-icon" style="background:#FEF3C7; color:#D97706;"><i class="ph-fill ph-check-square-offset"></i></div><div><span class="kpi-label">Em Validação</span><div class="kpi-val" style="color:#D97706">${noPcp}</div></div></div></div>
                <div class="kpi-card" onclick="document.getElementById('filter-status-monitor').value='Em Produção'; renderMonitorOrders()"><div style="display:flex; align-items:center; gap:15px;"><div class="kpi-icon" style="background:#E0F2FE; color:#0284C7;"><i class="ph-fill ph-hammer"></i></div><div><span class="kpi-label">Na Fábrica</span><div class="kpi-val" style="color:#0284C7">${naProd}</div></div></div></div>
                `;
            }

            if(monitorOrders.length === 0) { container.innerHTML='<div style="text-align:center; padding:80px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:var(--radius-card); border:1px solid var(--cor-borda); box-shadow:var(--sombra-sm);"><i class="ph-fill ph-binoculars" style="font-size:4rem; margin-bottom:15px; opacity:0.3;"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Tudo limpo!</strong><br>Nenhum pedido encontrado na fábrica.</div>'; return; }

            monitorOrders.sort((a,b) => {
                let sA = { dateStr: '9999-12-31' }, sB = { dateStr: '9999-12-31' };
                try { sA = SinalizaCore.calculateSLA(a) || sA; } catch(e){}
                try { sB = SinalizaCore.calculateSLA(b) || sB; } catch(e){}
                return new Date(sA.dateStr) - new Date(sB.dateStr);
            });

            container.innerHTML = monitorOrders.map(o => createMonitorRowHTML(o, finalStage)).join('');
        }

        function createMonitorRowHTML(o, finalStage) {
            const stepsSafe = configData.workflow.map(x => getSafeStatus(x.name)); 
            const oStatusSafe = getSafeStatus(o.status);
            
            let idx = stepsSafe.indexOf(oStatusSafe); 
            if(idx === -1) idx = 0; 
            
            let slaInfo = { status: 'normal', displayDate: 'N/D', dateStr: '9999-12-31' };
            try { slaInfo = SinalizaCore.calculateSLA(o, (o.prodData?.extensions || [])) || slaInfo; } catch(e){}
            
            const isLate = slaInfo.status === 'late';
            const originalSteps = configData.workflow.map(x => x.name);
            let displaySteps = originalSteps;
            
            if(originalSteps.length > 5) {
                if(idx < 3) displaySteps = originalSteps.slice(0, 4);
                else if (idx >= originalSteps.length - 2) displaySteps = originalSteps.slice(originalSteps.length - 4);
                else displaySteps = originalSteps.slice(idx - 1, idx + 3);
            }

            // Stepper HTML
            const stepperHTML = displaySteps.map((stepName, i) => { 
                const realIdx = stepsSafe.indexOf(getSafeStatus(stepName));
                let cls = '', ico = ''; let stepDate = '';

                if (realIdx <= idx) {
                    const historyMoves = Array.isArray(o.history) ? o.history : [];
                    const move = [...historyMoves].reverse().find(h => getSafeStatus(h.to) === getSafeStatus(stepName));
                    if (move && move.date) {
                        try {
                            const d = new Date(move.date);
                            if(!isNaN(d)) stepDate = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
                        } catch(e){}
                    } else if (realIdx === 0 && o.created_at) { 
                        try {
                            const d = new Date(o.created_at);
                            if(!isNaN(d)) stepDate = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
                        } catch(e){}
                    }
                }

                if (realIdx < idx) { cls = 'done'; ico = '<i class="ph-bold ph-check"></i>'; } 
                else if (realIdx === idx) { cls = isLate ? 'active late' : 'active'; } 
                
                const hasLine = i < displaySteps.length - 1;
                
                return `
                <div class="stepper-item ${cls}">
                    <span class="stepper-date">${stepDate}</span>
                    <div class="stepper-circle">${ico}</div>
                    <span class="stepper-label">${String(stepName).substring(0, 15)}</span>
                    ${hasLine ? '<div class="stepper-line"></div>' : ''}
                </div>`; 
            }).join('');
            
            let tipoPedido = String(o.tipo_pedido || 'convencional').toLowerCase().trim();
            let tagP = '';
            if (tipoPedido === 'urgente') tagP = `<div style="background:var(--danger-bg); color:var(--cor-erro); font-size:0.65rem; font-weight:700; padding:2px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:4px; border:1px solid #FCA5A5;"><i class="ph-fill ph-fire"></i> URGENTE</div>`;
            else if (tipoPedido === 'homologado') tagP = `<div class="tag-homologado"><i class="ph-fill ph-star"></i> HOMOL</div>`;
            else if (tipoPedido === 'projeto') tagP = `<div class="tag-projeto"><i class="ph-fill ph-blueprint"></i> PROJ</div>`;

            let rowClass = "list-row";
            if(isLate) rowClass += " late";

            let corSetor = 'var(--cor-texto)'; let bgSetor = 'var(--cor-panel-bg)';
            if(oStatusSafe === 'em layout') { corSetor = '#8B5CF6'; bgSetor = '#EDE9FE'; }
            else if(oStatusSafe.includes('pcp')) { corSetor = '#D97706'; bgSetor = '#FEF3C7'; }
            else if(oStatusSafe.includes('produ')) { corSetor = '#0284C7'; bgSetor = '#E0F2FE'; }
            else if(oStatusSafe.includes('faturam')) { corSetor = '#059669'; bgSetor = '#D1FAE5'; }

            let statusBadge = `<span class="status-pill" style="background:${bgSetor}; color:${corSetor};" onclick="event.stopPropagation(); openHistoryModal('${o.id}')" title="Ver Histórico">${o.status} <i class="ph-bold ph-clock-counter-clockwise" style="margin-left:4px;"></i></span>`;

            let safeClient = o.client ? String(o.client).replace(/"/g, '&quot;') : '';

            return `
            <div class="${rowClass}">
                <div class="row-header">
                    <div class="list-col-info">
                        <div class="info-top">
                            <span class="id-badge">#${o.id}</span>
                            ${tagP}
                            ${isLate ? '<span class="status-pill" style="background:var(--danger-bg); color:var(--cor-erro);"><i class="ph-fill ph-warning-circle"></i> Atrasado</span>' : ''}
                        </div>
                        <div class="client-name" title="${safeClient}">${safeClient || 'N/D'}</div>
                        <div class="info-bottom">
                            <span class="date-val" onclick="openEditDateModal('${o.id}', '${slaInfo.dateStr}')" style="cursor:pointer;" title="Corrigir Prazo com a Fábrica">
                                <i class="ph-bold ph-calendar-blank"></i> Prazo: <strong>${slaInfo.displayDate}</strong> <i class="ph-bold ph-pencil-simple"></i>
                            </span>
                            <span><i class="ph-fill ph-user-circle"></i> ${o.sales || 'N/D'}</span>
                        </div>
                    </div>

                    <div class="list-col-stepper" onclick="openHistoryModal('${o.id}')" title="Ver Histórico de Produção">
                        <div class="stepper-wrapper">${stepperHTML}</div>
                    </div>

                    <div class="order-field">
                        <span>Setor atual</span>
                        <strong>${statusBadge}</strong>
                    </div>

                    <div class="order-field">
                        <span>Valor</span>
                        <strong class="money-val">${o.value ? moneyFmt.format(parseFloat(o.value)) : 'N/D'}</strong>
                    </div>

                    <div class="list-col-actions">
                        <button class="btn-act primary" onclick="abrirPreview('${o.id}')" title="Ver Ficheiros/Projetos na Rede"><i class="ph-bold ph-folder-open"></i></button>
                        <button class="btn-act" onclick="openHistoryModal('${o.id}')" title="Histórico"><i class="ph-bold ph-clock-counter-clockwise"></i></button>
                    </div>
                </div>
            </div>`;

            return `
            <div class="${rowClass}">
                <div class="list-col-info">
                    <div class="info-top">
                        <span class="id-badge">#${o.id}</span>
                        ${tagP}
                    </div>
                    <div class="client-name" title="${safeClient}">${safeClient || 'N/D'}</div>
                    <div class="info-bottom">
                        <span class="date-val" onclick="openEditDateModal('${o.id}', '${slaInfo.dateStr}')" style="cursor:pointer;" title="Corrigir Prazo com a Fábrica">
                            <i class="ph-bold ph-calendar-blank"></i> Praz: <strong>${slaInfo.displayDate}</strong> <i class="ph-bold ph-pencil-simple"></i>
                        </span>
                        <span style="display:flex; align-items:center; gap:4px;"><i class="ph-fill ph-user-circle"></i> Vend: ${o.sales || 'N/D'}</span>
                    </div>
                </div>

                <div class="list-col-stepper" onclick="openHistoryModal('${o.id}')" title="Ver Histórico de Produção">
                    <div class="stepper-wrapper">
                        ${stepperHTML}
                    </div>
                </div>

                <div class="list-col-actions" style="flex:0.5; min-width: 140px; justify-content: flex-end;">
                    ${statusBadge}
                    <div class="action-buttons" style="margin-top:4px;">
                        <button class="btn-act primary" onclick="abrirPreview('${o.id}')" title="Ver Ficheiros/Projetos na Rede"><i class="ph-bold ph-folder-open"></i></button>
                    </div>
                </div>
            </div>`;
        }

        // ==========================================
        // 🚀 LÓGICA DE UPLOAD E ENVIO (DUPLA INTEGRAÇÃO: VPN + ORACLE)
        // ==========================================
        function openBriefingModal(id, currentDelivery) {
            const o = ordersData.find(x => x.id == id);
            if(!o) return;
            
            document.getElementById('br-id').value = id;
            document.getElementById('br-order-id').innerText = '#' + id;
            document.getElementById('br-tipo').value = o.tipo_pedido || 'Normal';
            document.getElementById('br-data-layout').value = o.delivery || currentDelivery || '';
            document.getElementById('br-whatsapp').value = o.contact || '';
            document.getElementById('br-email').value = o.email || '';
            document.getElementById('br-obs').value = o.obs || '';

            layoutSelectedFiles = []; 
            document.getElementById('br-file-preview').innerHTML = '';
            document.getElementById('briefingModal').style.display = 'flex';
        }

        function handleLayoutFileSelect(input) { 
            layoutSelectedFiles = [...layoutSelectedFiles, ...Array.from(input.files)]; 
            document.getElementById('br-file-preview').innerHTML = layoutSelectedFiles.map((f, i) => `<div class="file-chip"><span>${f.name}</span><i class="ph-fill ph-x-circle" style="cursor:pointer; margin-left:4px; color:var(--cor-erro);" onclick="removeLayoutFile(${i}); event.stopPropagation();"></i></div>`).join(''); 
        }
        
        function removeLayoutFile(i) { 
            layoutSelectedFiles.splice(i, 1); 
            document.getElementById('br-file-preview').innerHTML = layoutSelectedFiles.map((f, i) => `<div class="file-chip"><span>${f.name}</span><i class="ph-fill ph-x-circle" style="cursor:pointer; margin-left:4px; color:var(--cor-erro);" onclick="removeLayoutFile(${i}); event.stopPropagation();"></i></div>`).join(''); 
        }

        async function confirmBriefing() {
            const id = document.getElementById('br-id').value;
            const tipo = document.getElementById('br-tipo').value;
            const dataEntregaGlobal = document.getElementById('br-data-layout').value;
            const wpp = document.getElementById('br-whatsapp').value;
            const email = document.getElementById('br-email').value;
            const obs = document.getElementById('br-obs').value;

            if(!dataEntregaGlobal) return Swal.fire("Atenção", "É obrigatório confirmar a Data de Entrega do projeto.", "warning");

            const btn = document.getElementById('btn-submit-layout'); 
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Processando...'; btn.disabled = true;

            const o = ordersData.find(x => x.id == id);
            const nomeVendedor = currentUser ? currentUser.toUpperCase() : 'COMERCIAL';
            const nextStep = configData.workflow.length > 1 ? configData.workflow[1].name : 'Em Layout';
            const newHist = [...(o.history||[]), SinalizaCore.buildHistoryEntry('Briefing Finalizado', nextStep, nomeVendedor, tipo, 'Aprovado para a fábrica.')];

            // ==========================================
            // CORREÇÃO: SEMPRE TOCA NA VPN PARA CRIAR A PASTA
            // ==========================================
            const formData = new FormData(); 
            formData.append('id', id); 
            
            // Só anexa arquivos se eles existirem
            if (layoutSelectedFiles.length > 0) {
                layoutSelectedFiles.forEach(f => formData.append('files', f));
            }
            
            try { 
                // Dispara para a VPN independentemente de ter ficheiros ou não
                await fetch(`${SinalizaCore.VPN_URL}/api/layout/update`, { method: 'POST', body: formData }); 
            } catch(e) { 
                console.warn("Aviso: Agente local indisponível, mas os dados seguirão para a nuvem."); 
            }
            // ==========================================

            try { 
                const payload = {
                    status: nextStep,
                    tipo_pedido: tipo,
                    data_entrega: dataEntregaGlobal, 
                    contato: wpp,
                    email: email,
                    obs: obs,
                    history: newHist,
                    ...SinalizaCore.gerarTimestamps('Comercial', nextStep) 
                };

                await apiFetch(`/pedidos/${id}`, 'PUT', payload);

                Swal.fire({toast: true, position: 'top-end', icon: 'success', title: `Enviado para ${nextStep}!`, showConfirmButton: false, timer: 3000}); 
                document.getElementById('briefingModal').style.display = 'none'; 
                loadData(); 
            } catch(e) { 
                Swal.fire('Erro Técnico do Oracle', e.message, 'error'); 
            } finally { 
                btn.innerHTML = originalText; btn.disabled = false; 
            }
        }

        // ==========================================
        // 🚀 DEVOLUÇÕES (REENVIO BLINDADO)
        // ==========================================
        function openResendModal(id) {
            const o = ordersData.find(x => String(x.id) === String(id)); if(!o) return; 
            let origin = 'Em Layout'; 
            if (o.history && o.history.length > 0) {
                const hist = o.history;
                const lastReturn = [...hist].reverse().find(h => getSafeStatus(h.to) === getSafeStatus(o.status)); 
                if (lastReturn) { 
                    const act = lastReturn.action.toLowerCase();
                    const usr = (lastReturn.user || '').toLowerCase();
                    if(act.includes('faturam') || usr.includes('fat')) origin = 'Em Faturamento'; 
                    else if(act.includes('pcp') || usr.includes('pcp')) origin = 'PCP Revisão'; 
                    else if(act.includes('produ') || usr.includes('prod')) origin = 'Em Produção'; 
                    else origin = 'Em Layout';
                } 
            }
            
            document.getElementById('resend-order-id').innerText = '#' + id;
            document.getElementById('resend-id').value = id; 
            
            const sel = document.getElementById('resend-target'); sel.innerHTML = '';
            configData.workflow.forEach((w, idx) => { 
                if(idx > 0) { 
                    const isSelected = getSafeStatus(w.name) === getSafeStatus(origin) ? 'selected' : ''; 
                    sel.innerHTML += `<option value="${w.name}" ${isSelected}>${w.name}</option>`; 
                } 
            });
            
            document.getElementById('resend-obs').value = ''; 
            resendSelectedFiles = []; document.getElementById('resend-file-preview').innerHTML = ''; 
            document.getElementById('resendModal').style.display = 'flex';
        }

        function handleResendFileSelect(input) { 
            resendSelectedFiles = [...resendSelectedFiles, ...Array.from(input.files)]; 
            document.getElementById('resend-file-preview').innerHTML = resendSelectedFiles.map((f, i) => `<div class="file-chip"><span>${f.name}</span><i class="ph-fill ph-x-circle" style="cursor:pointer; margin-left:4px; color:var(--cor-erro);" onclick="removeResendFile(${i}); event.stopPropagation();"></i></div>`).join(''); 
        }

        function removeResendFile(i) { 
            resendSelectedFiles.splice(i, 1); 
            document.getElementById('resend-file-preview').innerHTML = resendSelectedFiles.map((f, i) => `<div class="file-chip"><span>${f.name}</span><i class="ph-fill ph-x-circle" style="cursor:pointer; margin-left:4px; color:var(--cor-erro);" onclick="removeResendFile(${i}); event.stopPropagation();"></i></div>`).join(''); 
        }

        async function submitResend() {
            const id = document.getElementById('resend-id').value;
            const target = document.getElementById('resend-target').value;
            const obsText = document.getElementById('resend-obs').value;
            
            if(!obsText.trim()) return Swal.fire('Atenção', 'Explique o que foi corrigido no campo de observação.', 'warning');
            
            const btn = document.getElementById('btn-submit-resend'); 
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Processando...'; btn.disabled = true;

            try {
                if(resendSelectedFiles.length > 0) { 
                    const formData = new FormData(); formData.append('id', id); 
                    resendSelectedFiles.forEach(f => formData.append('files', f));
                    try { await fetch(`${SinalizaCore.VPN_URL}/api/layout/update`, { method: 'POST', body: formData }); }catch(e){}
                }
                
                const dbOrder = ordersData.find(o => String(o.id) === String(id));
                if(dbOrder) { 
                    const nomeVendedor = currentUser ? currentUser.toUpperCase() : 'COMERCIAL';
                    const newEntry = SinalizaCore.buildHistoryEntry('Correção Enviada', target, nomeVendedor, '', obsText); 
                    const newHist = [...(dbOrder.history||[]), newEntry]; 
                    
                    const updatePayload = { status: target, history: newHist, ...SinalizaCore.gerarTimestamps(dbOrder.status, target) };
                    await apiFetch(`/pedidos/${id}`, 'PUT', updatePayload);
                }
                
                Swal.fire({toast: true, position: 'top-end', icon: 'success', title: `Reenviado para ${target}.`, showConfirmButton: false, timer: 3000}); 
                document.getElementById('resendModal').style.display = 'none'; 
                loadData();
            } catch(e) { Swal.fire('Erro', 'Falha ao atualizar o status.', 'error'); } 
            finally { btn.innerHTML = originalText; btn.disabled = false; }
        }

        // ==========================================
        // 🚀 VER FICHEIROS, EDIT DATA E HISTÓRICO 
        // ==========================================
        function openEditDateModal(id, currentDate) {
            const o = ordersData.find(x => String(x.id) === String(id));
            const currentValue = currentDate && currentDate !== '9999-12-31'
                ? currentDate
                : (o ? o.delivery : '');

            document.getElementById('edit-date-id').value = id;
            document.getElementById('new-delivery-date').value = toDateInputValue(currentValue);
            document.getElementById('comercialNovaData').value = toDateInputValue(currentValue);
            document.getElementById('comercialMotivoAlteracaoData').value = '';
            document.getElementById('comercialObsAlteracaoData').value = '';
            document.getElementById('comercialDataPedidoId').innerText = id ? `#${id}` : '--';
            document.getElementById('comercialDataCliente').innerText = o && o.client ? o.client : 'N/D';
            document.getElementById('comercialDataAtual').innerText = formatDateBR(currentValue);
            document.getElementById('editDateModal').style.display = 'flex';
        }

        async function saveNewDateLegacy() {
            const id = document.getElementById('edit-date-id').value;
            const newDate = document.getElementById('new-delivery-date').value;
            if(!newDate) return Swal.fire('Aviso', 'Selecione uma data válida.', 'warning');
            
            const o = ordersData.find(x => String(x.id) === String(id));
            if(!o) return;
            
            const dateStrBR = String(newDate).split('-').reverse().join('/');
            const oldHistory = Array.isArray(o.history) ? o.history : [];
            const userName = currentUser ? currentUser.toUpperCase() : 'COMERCIAL';
            const newEntry = SinalizaCore.buildHistoryEntry('Ajuste de Prazo', o.status, userName, '', `A fábrica foi avisada. Data alterada para ${dateStrBR}`);
            const newHistory = [...oldHistory, newEntry];
            
            try { 
                await apiFetch(`/pedidos/${id}`, 'PUT', { data_entrega: newDate, history: newHistory });
                document.getElementById('editDateModal').style.display = 'none'; 
                Swal.fire({toast:true, position:'top-end', title:'Data atualizada com a fábrica!', icon:'success', showConfirmButton:false, timer:3000});
                loadData(); 
            } catch(e) { Swal.fire('Erro', 'Falha ao salvar a data.', 'error'); }
        }

        async function saveNewDate() {
            const id = document.getElementById('edit-date-id').value;
            const newDate = document.getElementById('comercialNovaData').value;
            const motivo = document.getElementById('comercialMotivoAlteracaoData').value;
            const obs = document.getElementById('comercialObsAlteracaoData').value.trim();

            if(!id) return Swal.fire('Aviso', 'Nenhum pedido selecionado para alterar.', 'warning');
            if(!newDate) return Swal.fire('Aviso', 'Selecione uma data valida.', 'warning');
            if(!motivo) return Swal.fire('Aviso', 'Selecione o motivo da alteracao.', 'warning');

            const o = ordersData.find(x => String(x.id) === String(id));
            if(!o) return Swal.fire('Aviso', 'Pedido nao encontrado na lista atual.', 'warning');

            const dateStrBR = String(newDate).split('-').reverse().join('/');
            const oldDateBR = formatDateBR(o.delivery);
            const motivoLabel = getDateChangeReasonLabel(motivo);
            const oldHistory = Array.isArray(o.history) ? o.history : [];
            const userName = currentUser ? currentUser.toUpperCase() : 'COMERCIAL';
            const historyText = [
                'Data/Prazo alterado pelo Comercial',
                `Data anterior: ${oldDateBR}`,
                `Nova data: ${dateStrBR}`,
                `Motivo: ${motivoLabel}`,
                obs ? `Observacao: ${obs}` : '',
                `Usuario: ${userName}`
            ].filter(Boolean).join('\n');
            const newEntry = SinalizaCore.buildHistoryEntry('Data/Prazo alterado pelo Comercial', o.status, userName, '', historyText);
            const newHistory = [...oldHistory, newEntry];
            const btn = document.getElementById('btn-save-comercial-date');
            const originalText = btn ? btn.innerHTML : '';

            try {
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Salvando...';
                }
                await apiFetch(`/pedidos/${id}`, 'PUT', { data_entrega: newDate, history: newHistory });
                document.getElementById('editDateModal').style.display = 'none';
                Swal.fire({toast:true, position:'top-end', title:'Prazo atualizado pelo Comercial!', icon:'success', showConfirmButton:false, timer:3000});
                loadData();
            } catch(e) {
                Swal.fire('Erro', 'Falha ao salvar a data: ' + (e.message || e), 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        }

        async function abrirPreview(id) { openFilesModal(id); }

        async function openFilesModal(id) {
            document.getElementById('modal-order-id').innerText = id;
            document.getElementById('filesModal').style.display = 'flex';
            
            const list = document.getElementById('file-list-container');
            const preview = document.getElementById('preview-container');
            
            list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--cor-texto-mutado);"><i class="ph-bold ph-spinner ph-spin" style="font-size:2.5rem; margin-bottom:10px; color:var(--cor-primaria);"></i><br><strong style="font-size:0.9rem;">Acessando Rede...</strong></div>';
            preview.innerHTML = '<div style="color:var(--cor-texto-mutado); display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; font-weight:600;"><i class="ph-fill ph-image" style="font-size:4rem; margin-bottom:15px; opacity:0.2;"></i> Selecione um arquivo</div>';

            try {
                const arquivosBrutos = await SinalizaCore.fetchFilesFromVPN(id);
                if(!arquivosBrutos || arquivosBrutos.length === 0) { list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--cor-texto-mutado);"><i class="ph-fill ph-empty" style="font-size:2.5rem; margin-bottom:10px;"></i><br><strong>Pasta física vazia.</strong></div>'; return; }

                list.innerHTML = '';
                arquivosBrutos.forEach(f => {
                    const item = document.createElement('div'); item.className = 'file-item';
                    let icon = 'ph-file';
                    if(f.ext === 'pdf') icon = 'ph-file-pdf'; else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) icon = 'ph-image'; else if(['xls','xlsx','csv'].includes(f.ext)) icon = 'ph-file-xls';
                    const badge = f.folder.toLowerCase().replace(/[\u0300-\u036f]/g, "");
                    
                    item.innerHTML = `<div style="display:flex; align-items:center; gap:8px; overflow:hidden;"><i class="ph-fill ${icon}" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f.name}">${f.name}</span></div><span class="file-item-badge ${badge}">${f.folder}</span>`;
                    
                    item.onclick = () => {
                        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active')); item.classList.add('active');
                        const url = `${SinalizaCore.VPN_URL}${f.url}`;
                        preview.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><i class="ph-bold ph-spinner ph-spin" style="font-size:3rem; color:var(--cor-primaria);"></i></div>';
                        setTimeout(() => {
                            if(['pdf','html','txt'].includes(f.ext)) { preview.innerHTML = `<iframe src="${url}" class="preview-iframe"></iframe>`; } 
                            else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) { preview.innerHTML = `<img src="${url}" style="max-width:90%; max-height:90%; object-fit:contain; border-radius: 8px; box-shadow: var(--sombra-md);">`; } 
                            else { preview.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--cor-texto);"><div style="background:var(--cor-card-bg); padding:30px; border-radius:12px; border:1px solid var(--cor-borda); text-align:center; box-shadow:var(--sombra-sm);"><i class="ph-fill ph-download-simple" style="font-size:3rem; margin-bottom:15px; color:var(--cor-primaria);"></i><p style="margin-bottom:15px; font-weight:700; font-size:0.95rem;">Pronto para download.</p><a href="${url}" target="_blank" class="btn btn-primary" style="text-decoration:none;">Baixar Arquivo</a></div></div>`; }
                        }, 100);
                    };
                    list.appendChild(item);
                });
            } catch(e) { list.innerHTML = `<div style="padding:40px; text-align:center; color:var(--cor-erro);"><i class="ph-fill ph-warning-circle" style="font-size:2.5rem; margin-bottom:10px;"></i><br><b>Erro de VPN.</b></div>`; }
        }
        function closeFilesModal() { document.getElementById('filesModal').style.display = 'none'; document.getElementById('preview-container').innerHTML = ''; }

        function openHistoryModal(id) {
            const o = ordersData.find(x => String(x.id) === String(id)); if(!o) return; document.getElementById('hist-order-id').innerText = '#' + id; const container = document.getElementById('history-container'); container.innerHTML = '';
            if (!o.history || o.history.length === 0) { container.innerHTML = '<div style="text-align:center; padding: 50px 20px; color:var(--cor-texto-mutado);"><i class="ph-fill ph-ghost" style="font-size:3.5rem; margin-bottom:10px; opacity:0.3;"></i><br><strong style="font-size:0.95rem;">Sem Histórico!</strong></div>'; } 
            else {
                const histRev = [...o.history].reverse();
                histRev.forEach((h, index) => {
                    const dateObj = new Date(h.date); const dateStr = dateObj.toLocaleDateString('pt-BR') + ' às ' + dateObj.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
                    let actionBadge = ''; if(h.action.includes('Admin') || h.action.includes('Bypass') || h.action.includes('Massa')) { actionBadge = `<span style="background:var(--warning-bg); color:var(--cor-alerta); padding:2px 8px; border-radius:6px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; } else if(h.action.includes('Ajuste') || h.action.includes('Prazo')) { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); padding:2px 8px; border-radius:6px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; } else { actionBadge = `<span style="background:#D1FAE5; color:var(--cor-sucesso); padding:2px 8px; border-radius:6px; font-size:0.65rem; font-weight:700;">MOVIMENTAÇÃO</span>`; }
                    let obsHtml = h.obs ? `<div class="history-obs">${h.obs}</div>` : ''; let isCurrent = index === 0 ? `<span style="color:var(--cor-primaria); font-size:0.65rem; border:1px solid var(--cor-primaria); padding:2px 6px; border-radius:4px; margin-left:auto; font-weight:700;">ETAPA ATUAL</span>` : '';
                    container.innerHTML += `<div class="history-item"><div class="history-date"><i class="ph-bold ph-calendar-blank"></i> ${dateStr} ${isCurrent}</div><div class="history-title"><i class="ph-fill ph-user-circle" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="font-weight:700; font-size:0.95rem;">${h.user || 'Sistema'}</span> <i class="ph-bold ph-arrow-right" style="color:var(--cor-texto-mutado)"></i> <span>${h.to}</span> ${actionBadge}</div>${obsHtml}</div>`;
                });
            } document.getElementById('historyModal').style.display = 'flex';
        }
        function closeHistoryModal() { document.getElementById('historyModal').style.display = 'none'; }

        // ==========================================
        // 🚀 GRÁFICOS E CALENDÁRIO
        // ==========================================
        function initCalendar() {
            const calendarEl = document.getElementById('calendar');
            calendar = new FullCalendar.Calendar(calendarEl, { 
                initialView: 'dayGridMonth', locale: 'pt-br', 
                headerToolbar: { left: 'prev,next', center: 'title', right: 'dayGridMonth,listWeek' }, 
                height: '100%', events: [], 
                eventClick: function(info) { Swal.fire({ title: info.event.title, text: 'Previsão de Entrega: ' + info.event.start.toLocaleDateString('pt-BR'), icon: 'info', confirmButtonColor: 'var(--cor-primaria)' }); } 
            });
            calendar.render();
        }

        function updateCalendarEvents() {
            if (!calendar) return;
            const events = ordersData.filter(o => { const sla = SinalizaCore.calculateSLA(o); return sla.dateStr !== '9999-12-31' && isOwner(o.sales); }).map(o => {
                let color = '#059669'; const step = configData.workflow.find(s => getSafeStatus(s.name) === getSafeStatus(o.status));
                if (step) { if(step.role === 'pcp') color = '#D97706'; if(step.role === 'layout') color = '#8B5CF6'; if(step.role === 'producao') color = '#0284C7'; if(step.role === 'faturamento') color = '#059669'; }
                return { title: `${o.client} (#${o.id})`, start: SinalizaCore.calculateSLA(o).dateStr, color: color, allDay: true };
            });
            calendar.removeAllEvents(); calendar.addEventSource(events);
        }

        function getFilteredData() {
            const period = document.getElementById('period-filter').value;
            if (period === 'all') return ordersData;
            const now = new Date(); let s = new Date(), e = new Date();
            if (period === 'this_month') { s = new Date(now.getFullYear(), now.getMonth(), 1); e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); } 
            else if (period === 'last_month') { s = new Date(now.getFullYear(), now.getMonth() - 1, 1); e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); } 
            else if (period === 'this_year') { s = new Date(now.getFullYear(), 0, 1); e = new Date(now.getFullYear(), 11, 31, 23, 59, 59); } 
            return ordersData.filter(o => { let r = o.issue_date || o.created_at; if (!r) return false; if (r.length === 10) r += 'T12:00:00'; const d = new Date(r); return d >= s && d <= e; });
        }

        function applyPeriodFilter() { 
            const select = document.getElementById('period-filter'); 
            const label = select.options[select.selectedIndex].text; 
            document.getElementById('period-label').innerText = "A filtrar por: " + label; 
            if(!document.getElementById('view-dash').classList.contains('hidden')) { updateKPIs(); renderChart(); renderAnalytics(); updateCalendarEvents(); } 
        }

        function updateKPIs() {
            const period = document.getElementById('period-filter').value;
            const now = new Date(); 
            let s = new Date(2000, 0, 1), e = new Date(2100, 0, 1);
            
            if (period === 'this_month') { 
                s = new Date(now.getFullYear(), now.getMonth(), 1); 
                e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); 
            } else if (period === 'last_month') { 
                s = new Date(now.getFullYear(), now.getMonth() - 1, 1); 
                e = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); 
            } else if (period === 'this_year') { 
                s = new Date(now.getFullYear(), 0, 1); 
                e = new Date(now.getFullYear(), 11, 31, 23, 59, 59); 
            }

            let userSold = 0, userInvoiced = 0, globalSold = 0, globalInvoiced = 0; 
            const finalStage = configData.workflow.length > 0 ? getSafeStatus(configData.workflow[configData.workflow.length-1].name) : 'finalizado';

            ordersData.forEach(o => {
                const val = parseFloat(o.value || 0); 
                const isOwnerOrder = isOwner(o.sales);

                // 1. MÉTRICA DE VENDAS (Olha para a Data de Criação/Emissão)
                let dataVendaStr = o.issue_date || o.created_at; 
                if (dataVendaStr) {
                    if (dataVendaStr.length === 10) dataVendaStr += 'T12:00:00'; 
                    const dVenda = new Date(dataVendaStr);
                    if (period === 'all' || (dVenda >= s && dVenda <= e)) {
                        globalSold += val;
                        if (isOwnerOrder) userSold += val;
                    }
                }

                // 2. MÉTRICA DE FATURAMENTO (Data exata da última movimentação que finalizou o pedido)
                let dFaturamento = null;
                const currentStatus = getSafeStatus(o.status);
                
                // Se o pedido chegou no fim da esteira
                if (currentStatus === finalStage || currentStatus.includes('finaliz') || currentStatus.includes('entregue')) {
                    const hist = o.history || [];
                    
                    if (hist.length > 0) {
                        // Tenta achar o clique exato de faturamento
                        let fatLog = [...hist].reverse().find(h => 
                            getSafeStatus(h.to) === finalStage || 
                            getSafeStatus(h.to).includes('finaliz') ||
                            String(h.action).toLowerCase().includes('fatur')
                        );
                        
                        // Se não tem a palavra exata, a ÚLTIMA ação do pedido é a data de conclusão!
                        if (!fatLog) {
                            fatLog = hist[hist.length - 1]; 
                        }
                        
                        if (fatLog && fatLog.date) {
                            dFaturamento = new Date(fatLog.date);
                        }
                    }
                    
                    // Fallback extremo: apenas se não existir NENHUM histórico
                    if (!dFaturamento && dataVendaStr) {
                        if (dataVendaStr.length === 10) dataVendaStr += 'T12:00:00';
                        dFaturamento = new Date(dataVendaStr);
                    }

                    if (dFaturamento && (period === 'all' || (dFaturamento >= s && dFaturamento <= e))) {
                        globalInvoiced += val;
                        if (isOwnerOrder) userInvoiced += val;
                    }
                }
            });

            const container = document.getElementById('kpi-container-top');
            container.innerHTML = `
                <div class="kpi-card" style="border-bottom: 4px solid var(--cor-primaria);">
                    <span class="kpi-label">Minha Carteira (Venda)</span><span class="kpi-val">${moneyFmt.format(userSold)}</span>
                </div>
                <div class="kpi-card" style="border-bottom: 4px solid var(--cor-sucesso);">
                    <span class="kpi-label">Meus Faturados</span><span class="kpi-val money">${moneyFmt.format(userInvoiced)}</span>
                </div>
                <div class="kpi-card" style="background: var(--cor-panel-bg);">
                    <span class="kpi-label">Vendas da Empresa</span><span class="kpi-val" style="font-size: 1.5rem; color:var(--cor-texto);">${moneyFmt.format(globalSold)}</span>
                </div>
                <div class="kpi-card" style="background: var(--cor-panel-bg);">
                    <span class="kpi-label">Faturamento Total</span><span class="kpi-val money" style="font-size: 1.5rem; color:var(--cor-sucesso);">${moneyFmt.format(globalInvoiced)}</span>
                </div>`;
        }

        function renderChart() {
            const salesByMonth = {}; 
            const finalStage = configData.workflow.length > 0 ? getSafeStatus(configData.workflow[configData.workflow.length-1].name) : 'finalizado';
            
            ordersData.forEach(o => { 
                const currentStatus = getSafeStatus(o.status);
                // Valida os pedidos do vendedor atual que estão concluídos
                if (isOwner(o.sales) && (currentStatus === finalStage || currentStatus.includes('finaliz') || currentStatus.includes('entregue'))) { 
                    const hist = o.history || [];
                    let dFaturamento = null;

                    if (hist.length > 0) {
                        let fatLog = [...hist].reverse().find(h => 
                            getSafeStatus(h.to) === finalStage || 
                            getSafeStatus(h.to).includes('finaliz') ||
                            String(h.action).toLowerCase().includes('fatur')
                        );
                        // Pega a última data de movimentação se não bater com a palavra-chave
                        if (!fatLog) fatLog = hist[hist.length - 1]; 
                        
                        if (fatLog && fatLog.date) dFaturamento = new Date(fatLog.date);
                    }
                    
                    let dataVendaStr = o.issue_date || o.created_at;
                    if (!dFaturamento && dataVendaStr) {
                        if (dataVendaStr.length === 10) dataVendaStr += 'T12:00:00'; 
                        dFaturamento = new Date(dataVendaStr);
                    }

                    if (dFaturamento) {
                        const key = `${dFaturamento.getFullYear()}-${String(dFaturamento.getMonth()+1).padStart(2, '0')}`; 
                        if (!salesByMonth[key]) salesByMonth[key] = 0; 
                        salesByMonth[key] += parseFloat(o.value || 0); 
                    }
                } 
            });
            
            const sortedKeys = Object.keys(salesByMonth).sort().slice(-6); 
            const categories = sortedKeys.map(k => { const [y, m] = k.split('-'); return `${m}/${y}`; }); 
            const data = sortedKeys.map(k => salesByMonth[k]);
            
            const themeMode = document.body.getAttribute('data-theme') || 'light';
            const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-primaria').trim() || '#059669';
            const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-texto-mutado').trim() || '#6B7280';
            const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-borda').trim() || '#E5E7EB';

            const options = { 
                series: [{ name: 'Meu Faturamento', data: data }], 
                chart: { type: 'bar', height: 320, toolbar: { show: false }, fontFamily: 'Inter, sans-serif', background: 'transparent' }, 
                colors: [primaryColor], 
                plotOptions: { bar: { borderRadius: 4, columnWidth: '40%' } }, 
                dataLabels: { enabled: false }, 
                xaxis: { categories: categories, labels: { style: { colors: mutedColor, fontWeight: 600 } }, axisBorder: { color: borderColor }, axisTicks: { color: borderColor } }, 
                yaxis: { labels: { style: { colors: mutedColor, fontWeight: 600 }, formatter: (val) => val.toLocaleString('pt-BR', {style:'currency', currency:'BRL'}) } }, 
                grid: { borderColor: borderColor, strokeDashArray: 4 }, 
                noData: { text: "Sem faturamento no período", align: 'center', verticalAlign: 'middle', style: { color: mutedColor, fontSize: '14px' } }, 
                theme: { mode: themeMode } 
            };
            if (salesChart) { salesChart.updateOptions(options); } else { salesChart = new ApexCharts(document.querySelector("#chart-sales"), options); salesChart.render(); }
        }

        function renderAnalytics() {
            const themeMode = document.body.getAttribute('data-theme') || 'light'; 
            const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-primaria').trim() || '#059669';
            const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-texto-mutado').trim() || '#6B7280';
            const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-borda').trim() || '#E5E7EB';
            const baseOptions = { chart: { background: 'transparent', toolbar: { show: false }, fontFamily: 'Inter, sans-serif' }, theme: { mode: themeMode } }; 
            const currentData = getFilteredData().filter(o => isOwner(o.sales)); 
            
            const payments = {}; currentData.forEach(o => { const p = o.payment || 'Não Informado'; if(!payments[p]) payments[p] = 0; payments[p]++; }); const payOpt = { ...baseOptions, chart: { type: 'pie', height: 300 }, series: Object.values(payments), labels: Object.keys(payments), colors: ['#059669', '#10b981', '#f59e0b', '#EF4444', '#8b5cf6'], noData: { text: 'Sem dados', style: { color: mutedColor } }, stroke: { colors: [borderColor] } }; if(paymentChart) paymentChart.updateOptions(payOpt); else { paymentChart = new ApexCharts(document.querySelector("#chart-payment"), payOpt); paymentChart.render(); }
            const clients = {}; currentData.forEach(o => { const c = o.client || 'N/D'; if(!clients[c]) clients[c] = 0; clients[c] += parseFloat(o.value || 0); }); const sortedClients = Object.entries(clients).sort((a,b) => b[1] - a[1]).slice(0, 5); const clientOpt = { ...baseOptions, chart: { type: 'bar', height: 300 }, plotOptions: { bar: { horizontal: true, borderRadius: 4 } }, series: [{ name: 'Valor', data: sortedClients.map(x => x[1]) }], xaxis: { categories: sortedClients.map(x => x[0]), labels: { style: { colors: mutedColor, fontWeight: 600 }, formatter: (val) => val.toLocaleString('pt-BR', {style:'currency', currency:'BRL', maximumFractionDigits:0}) }, axisBorder: { color: borderColor } }, yaxis: { labels: { style: { colors: mutedColor, fontWeight: 600 } } }, grid: { borderColor: borderColor, strokeDashArray: 4 }, colors: ['#F59E0B'], noData: { text: 'Sem dados', style: { color: mutedColor } } }; if(clientsChart) clientsChart.updateOptions(clientOpt); else { clientsChart = new ApexCharts(document.querySelector("#chart-clients"), clientOpt); clientsChart.render(); }
            const statusCounts = {}; configData.workflow.forEach(w => statusCounts[w.name] = 0); currentData.forEach(o => { if(statusCounts[o.status] !== undefined) statusCounts[o.status]++; }); const statusOpt = { ...baseOptions, chart: { type: 'bar', height: 300 }, plotOptions: { bar: { borderRadius: 4, columnWidth: '50%' } }, series: [{ name: 'Pedidos', data: Object.values(statusCounts) }], xaxis: { categories: Object.keys(statusCounts), labels: { style: { colors: mutedColor, fontWeight: 600 } }, axisBorder: { color: borderColor } }, yaxis: { labels: { style: { colors: mutedColor, fontWeight: 600 } } }, grid: { borderColor: borderColor, strokeDashArray: 4 }, colors: [primaryColor], noData: { text: 'Sem dados', style: { color: mutedColor } } }; if(statusChart) statusChart.updateOptions(statusOpt); else { statusChart = new ApexCharts(document.querySelector("#chart-status"), statusOpt); statusChart.render(); }
            const daily = {}; currentData.forEach(o => { if(o.created_at) { try { const k = String(o.created_at).split('T')[0]; if(!daily[k]) daily[k] = 0; daily[k]++; } catch(e){} } }); const sortedDates = Object.keys(daily).sort(); const dailyOpt = { ...baseOptions, chart: { type: 'area', height: 300 }, series: [{ name: 'Meus Pedidos', data: sortedDates.map(k => daily[k]) }], xaxis: { categories: sortedDates.map(k => k.split('-').reverse().slice(0,2).join('/')), labels: { style: { colors: mutedColor, fontWeight: 600 } }, axisBorder: { color: borderColor } }, yaxis: { labels: { style: { colors: mutedColor, fontWeight: 600 } } }, grid: { borderColor: borderColor, strokeDashArray: 4 }, stroke: { curve: 'smooth', width: 3 }, colors: ['#10b981'], fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 100] } }, noData: { text: 'Sem dados', style: { color: mutedColor } } }; if(dailyChart) dailyChart.updateOptions(dailyOpt); else { dailyChart = new ApexCharts(document.querySelector("#chart-daily"), dailyOpt); dailyChart.render(); }
        }

        function toggleTheme() { const b=document.body; const c=b.getAttribute('data-theme'); const n=c==='dark'?'light':'dark'; b.setAttribute('data-theme',n); localStorage.setItem('theme',n); updateThemeIcon(n); if(salesChart) { renderChart(); renderAnalytics(); } }
        function loadTheme() { const t=localStorage.getItem('theme')||'light'; document.body.setAttribute('data-theme',t); updateThemeIcon(t); }
        function updateThemeIcon(t) { const i=document.getElementById('theme-icon'); const txt = document.getElementById('theme-text'); if(t==='dark'){i.className='ph-fill ph-sun';txt.innerText='Modo Claro';}else{i.className='ph-fill ph-moon';txt.innerText='Modo Escuro';} }

        // ==========================================
        // 🚀 SCRIPTS DAS FERRAMENTAS INTERNAS
        // ==========================================
        
        // --- Dashboard / Ferramentas ---
        const materiais = {
            "papel": { peso_m2: 0.35, espessura: 0.048 }, "adesivo": { peso_m2: 0.50, espessura: 0.050 },
            "pvc2": { peso_m2: 1.00, espessura: 0.2 }, "pvc3": { peso_m2: 2.40, espessura: 0.3 }, 
            "pvc10": { peso_m2: 15.00, espessura: 1.0 }, "acm": { peso_m2: 3.94, espessura: 0.3 }, 
            "pvc_imantado": { peso_m2: 3.88, espessura: 0.35 }, "acrilico2": { peso_m2: 2.50, espessura: 0.2 }, 
            "policarbonato2": { peso_m2: 2.50, espessura: 0.2 }, "bobina": { peso_m2: 0.25, espessura: 0.05 }
        };

        function limparCaracteres() {
            const input = document.getElementById('input-limpar').value;
            const res = document.getElementById('resultado-limpar');
            const btn = document.getElementById('copiarBtn');
            if (!input) { res.style.display='block'; res.innerText="Digite algo."; res.style.borderLeftColor="var(--cor-alerta)"; return; }
            const limpo = input.replace(/\D/g, '');
            res.style.display='block'; res.innerText = limpo || "Sem números.";
            res.style.borderLeftColor = limpo ? "var(--cor-primaria)" : "var(--cor-alerta)";
            btn.style.display = limpo ? 'flex' : 'none';
        }

        function copiarResultado() {
            const txt = document.getElementById('resultado-limpar').innerText;
            if(txt) navigator.clipboard.writeText(txt).then(() => Swal.fire({toast:true, position:'top-end', icon:'success', title:'Copiado!', showConfirmButton:false, timer:2000}));
        }

        function calcular() {
            const mat = document.getElementById("material").value;
            const alt = parseFloat(document.getElementById("altura").value);
            const larg = parseFloat(document.getElementById("largura").value);
            const qtd = parseInt(document.getElementById("quantidade").value);
            const res = document.getElementById("resultadoCaixa");

            if (!mat || isNaN(alt) || isNaN(larg) || isNaN(qtd)) { 
                res.style.display="block"; res.innerHTML="Preencha tudo."; res.style.borderLeftColor="var(--cor-alerta)"; return; 
            }
            const fator = materiais[mat];
            const peso = (alt/100)*(larg/100) * fator.peso_m2 * qtd;
            const altCx = fator.espessura * qtd;
            res.style.display="block"; res.style.borderLeftColor="var(--cor-sucesso)";
            res.innerHTML = `Peso: <strong>${peso.toFixed(2)} kg</strong><br>Pilha: <strong>${altCx.toFixed(2)} cm</strong>`;
        }

        function calcularTubo() {
            const qtd = parseFloat(document.getElementById("qtdTubo").value);
            const comp = parseFloat(document.getElementById("compTubo").value);
            const res = document.getElementById("resultadoTubo");
            if (isNaN(qtd) || isNaN(comp)) { res.style.display="block"; res.innerText="Preencha tudo."; res.style.borderLeftColor="var(--cor-alerta)"; return; }
            const peso = qtd * 1.6 * comp;
            const vols = Math.ceil(qtd / 4);
            const dim = 10.16; // 2x 2pol em cm
            res.style.display="block"; res.style.borderLeftColor="var(--cor-sucesso)";
            res.innerHTML = `Peso: <strong>${peso.toFixed(2)} kg</strong><br>Volumes: <strong>${vols}</strong><br>Dimensão: <strong>${dim.toFixed(1)}x${dim.toFixed(1)} cm</strong>`;
        }

        // --- Rastreio ---
        function consultarRastreio() {
            const nf = document.getElementById("numeroNF").value.trim();
            const tr = document.getElementById("transportadora").value;

            if(!nf || !tr) { 
                if(typeof Swal !== 'undefined') {
                    Swal.fire('Aviso', 'Preencha a NF e a Transportadora.', 'warning');
                } else {
                    alert('Preencha a NF e a Transportadora.');
                }
                return; 
            }

            // Passa o parâmetro dinâmico direto para o portal de rastreio da iSinaliza
            const url = `https://rastreio.isinaliza.com/?c=${nf}&t=${tr}`;

            if(typeof Swal !== 'undefined') {
                Swal.fire({toast:true, position:'top-end', icon:'info', title:'Buscando rastreio...', showConfirmButton:false, timer:1500});
            }
            
            setTimeout(() => {
                window.open(url, "_blank");
            }, 800);
        }

        // --- Contatos / Transportadoras ---
        function copiarEmail(email) {
            if(!email) return;
            navigator.clipboard.writeText(email).then(() => { Swal.fire({toast:true, position:'top-end', icon:'success', title:'E-mail copiado!', showConfirmButton:false, timer:2000}); });
        }
        function abrirWhats(phone) {
            if(phone) {
                const msg = encodeURIComponent(document.getElementById('msgPadrao').value);
                window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
            } else { Swal.fire({toast:true, position:'top-end', icon:'error', title:'WhatsApp não disponível', showConfirmButton:false, timer:2000}); }
        }
        function copiarMensagemPadrao() {
            const box = document.getElementById('msgPadrao');
            box.select();
            navigator.clipboard.writeText(box.value).then(() => { Swal.fire({toast:true, position:'top-end', icon:'success', title:'Mensagem copiada!', showConfirmButton:false, timer:2000}); });
        }

        // --- Portais ---
        function copyPassword(id) {
            const txt = document.getElementById(id).innerText;
            if(txt) navigator.clipboard.writeText(txt).then(() => Swal.fire({toast:true, position:'top-end', icon:'success', title:'Senha copiada!', showConfirmButton:false, timer:2000}));
        }

        function updatePassword(cardKey, userId, passId, obsId) {
            const u = document.getElementById(userId).innerText;
            const p = document.getElementById(passId).innerText;
            const o = document.getElementById(obsId).innerText;
            if(!u || !p) { Swal.fire('Aviso', 'Preencha usuário e senha.', 'warning'); return; }
            localStorage.setItem(cardKey+'_username', u);
            localStorage.setItem(cardKey+'_password', p);
            localStorage.setItem(cardKey+'_observation', o);
            Swal.fire({toast:true, position:'top-end', icon:'success', title:'Salvo no navegador!', showConfirmButton:false, timer:2000});
        }

        function loadSavedData() {
            [1,2,3,4,5,6,7,8,9,10].forEach(i => {
                const k = 'card-'+i, u = localStorage.getItem(k+'_username'), p = localStorage.getItem(k+'_password'), o = localStorage.getItem(k+'_observation');
                if(u && document.getElementById('user-'+i)) document.getElementById('user-'+i).innerText = u;
                if(p && document.getElementById('pass-'+i)) document.getElementById('pass-'+i).innerText = p;
                if(o && document.getElementById('obs-'+i)) document.getElementById('obs-'+i).innerText = o;
            });
            
            // Normas e Arquivos Preview
            document.querySelectorAll('.js-preview').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const name = link.getAttribute('data-name');
                    Swal.fire({title:`Visualizar ${name}?`, icon:'info', showCancelButton:true, confirmButtonText:'Abrir', confirmButtonColor:'var(--cor-primaria)'}).then((r)=>{
                        if(r.isConfirmed) window.open(link.getAttribute('href'), '_blank');
                    });
                });
            });

            // Galeria
            if (typeof listaArquivos === 'undefined' || listaArquivos.length === 0) {
                document.getElementById('aviso-erro').style.display = 'block';
            } else {
                carregarCategorias();
                renderizarGaleria();
            }
        }

        function copiarTexto(texto) {
            navigator.clipboard.writeText(texto).then(() => {
                Swal.fire({toast:true, position:'top-end', icon:'success', title:'Copiado: ' + texto, showConfirmButton:false, timer:2000});
            });
        }


// ====================================================
// PORTAIS MANUAIS — cadastro pelo usuário logado
// Salva no localStorage do navegador, separado por usuário.
// ====================================================
let portalLogoBase64 = '';

function getManualPortalStorageKey() {
    const userKey = (currentUser || 'global').toString().trim().toLowerCase();
    return `sinalizaflow_manual_portals_${userKey}`;
}

function getManualPortals() {
    try {
        return JSON.parse(localStorage.getItem(getManualPortalStorageKey()) || '[]');
    } catch (e) {
        return [];
    }
}

function setManualPortals(portals) {
    localStorage.setItem(getManualPortalStorageKey(), JSON.stringify(portals));
}

function openPortalManagerModal(type = 'cliente') {
    portalLogoBase64 = '';

    const modal = document.getElementById('portalManagerModal');
    if (!modal) return;

    document.getElementById('portal-manager-type').value = type;
    document.getElementById('portal-type').value = type;
    document.getElementById('portal-company').value = '';
    document.getElementById('portal-user').value = '';
    document.getElementById('portal-pass').value = '';
    document.getElementById('portal-url').value = '';
    document.getElementById('portal-obs-input').value = '';

    const title = document.getElementById('portal-manager-title');
    if (title) title.innerText = type === 'transportadora' ? 'Novo Portal de Transportadora' : 'Novo Portal de Cliente';

    const preview = document.getElementById('portal-logo-preview');
    if (preview) preview.innerHTML = '<i class="fa-regular fa-image"></i><span>Selecionar imagem</span>';

    const file = document.getElementById('portal-logo-file');
    if (file) file.value = '';

    modal.style.display = 'flex';
}

function closePortalManagerModal() {
    const modal = document.getElementById('portalManagerModal');
    if (modal) modal.style.display = 'none';
}

function handlePortalLogoFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        Swal.fire('Arquivo inválido', 'Selecione uma imagem para usar como logo.', 'warning');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        portalLogoBase64 = reader.result;

        const preview = document.getElementById('portal-logo-preview');
        if (preview) {
            preview.innerHTML = `<img src="${portalLogoBase64}" alt="Prévia da logo">`;
        }
    };
    reader.readAsDataURL(file);
}

function saveManualPortal() {
    const type = document.getElementById('portal-type').value || 'cliente';
    const company = document.getElementById('portal-company').value.trim();
    const user = document.getElementById('portal-user').value.trim();
    const pass = document.getElementById('portal-pass').value.trim();
    const url = document.getElementById('portal-url').value.trim();
    const obs = document.getElementById('portal-obs-input').value.trim();

    if (!company) {
        Swal.fire('Aviso', 'Informe o nome da empresa.', 'warning');
        return;
    }

    const portals = getManualPortals();

    portals.push({
        id: `manual-${Date.now()}`,
        type,
        company,
        user,
        pass,
        url: url || '#',
        obs,
        logo: portalLogoBase64,
        createdBy: currentUser || 'global',
        createdAt: new Date().toISOString()
    });

    setManualPortals(portals);
    renderManualPortals();
    closePortalManagerModal();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Portal cadastrado!',
        showConfirmButton: false,
        timer: 1800
    });
}

function deleteManualPortal(id) {
    Swal.fire({
        title: 'Remover portal?',
        text: 'Este portal será removido apenas deste navegador.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Remover',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444'
    }).then((result) => {
        if (!result.isConfirmed) return;

        const portals = getManualPortals().filter(portal => portal.id !== id);
        setManualPortals(portals);
        renderManualPortals();
    });
}

function escapePortalText(value = '') {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderManualPortalCard(portal) {
    const company = escapePortalText(portal.company || 'Portal');
    const user = escapePortalText(portal.user || 'Clique para preencher');
    const pass = escapePortalText(portal.pass || 'Clique para preencher');
    const obs = escapePortalText(portal.obs || 'Clique para obs...');
    const url = portal.url || '#';
    const logo = portal.logo
        ? `<img src="${portal.logo}" alt="${company}">`
        : `<span class="portal-logo-fallback">${company}</span>`;

    return `
        <div class="tool-card portal-card manual-portal">
            <div class="brand-logo-area portal-logo-area">${logo}</div>
            <div class="portal-company-name">${company}</div>

            <div class="creds-box portal-creds-box">
                <div><strong>Usuário:</strong> <span>${user}</span></div>
                <div><strong>Senha:</strong> <span>${pass}</span></div>
                <div class="portal-obs"><span>${obs}</span></div>
            </div>

            <div class="action-row-tools portal-card-actions">
                <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('${pass.replaceAll("'", "\\'")}')"><i class="fa-regular fa-copy"></i> Copiar</button>
                <a href="${url}" target="_blank" class="btn btn-secondary"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir</a>
            </div>

            <button class="btn btn-secondary portal-delete-btn" onclick="deleteManualPortal('${portal.id}')">
                <i class="fa-regular fa-trash-can"></i> Remover
            </button>
        </div>
    `;
}

function renderManualPortals() {
    document.querySelectorAll('.manual-portal').forEach(el => el.remove());

    const portals = getManualPortals();

    portals.forEach(portal => {
        const targetId = portal.type === 'transportadora' ? 'portais-transportadoras-grid' : 'portais-clientes-grid';
        const target = document.getElementById(targetId);
        if (target) {
            target.insertAdjacentHTML('beforeend', renderManualPortalCard(portal));
        }
    });
}


        // --- Galeria ---
        function carregarCategorias() {
            const select = document.getElementById('filtro-categorias');
            if(!select || typeof listaArquivos === 'undefined') return;
            const categorias = new Set(); 
            listaArquivos.forEach(caminho => {
                const limpo = caminho.replace(/['"]/g, '').replace(/\\/g, '/');
                if(!limpo.includes('/')) return;
                const pasta = limpo.split('/')[0];
                if(pasta) categorias.add(pasta);
            });
            Array.from(categorias).sort().forEach(cat => {
                const option = document.createElement('option');
                option.value = cat;
                option.innerText = cat;
                select.appendChild(option);
            });
        }

        function renderizarGaleria() {
            const container = document.getElementById('galeria-container');
            const filtro = document.getElementById('filtro-categorias').value;
            const avisoVazio = document.getElementById('aviso-vazio');
            if(!container || typeof listaArquivos === 'undefined') return;
            
            container.innerHTML = '';
            let contador = 0;

            listaArquivos.forEach(caminho => {
                const limpo = caminho.replace(/['"]/g, '').replace(/\\/g, '/');
                if(!limpo.trim() || !limpo.includes('/')) return;

                const partes = limpo.split('/');
                const pasta = partes[0];
                const arquivoNome = partes[partes.length-1]; 
                
                if (filtro !== 'todas' && pasta !== filtro) return;

                contador++;
                const ext = arquivoNome.split('.').pop().toLowerCase();
                let midia = '';
                const caminhoUrl = encodeURI(limpo);

                if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                    midia = `<img src="${caminhoUrl}" loading="lazy" alt="${arquivoNome}">`;
                } else if (['mp4', 'webm'].includes(ext)) {
                    midia = `<video src="${caminhoUrl}" controls style="width:100%; height:100%"></video>`;
                } else { return; }

                const card = document.createElement('div');
                card.className = 'gallery-card';
                card.innerHTML = `
                    <div class="preview-area">
                        <span class="folder-badge">${pasta}</span>
                        ${midia}
                    </div>
                    <div class="gallery-body">
                        <div class="file-name" title="${arquivoNome}">${arquivoNome}</div>
                        <button class="btn btn-success" style="margin-bottom:10px; background:#25D366;" onclick="copiarLinkGaleria('${caminhoUrl}')">
                            <i class="fa-brands fa-whatsapp"></i> Copiar Link
                        </button>
                        <a href="${caminhoUrl}" target="_blank" class="btn btn-secondary">
                            <i class="fa-solid fa-eye"></i> Ampliar
                        </a>
                    </div>
                `;
                container.appendChild(card);
            });

            if (contador === 0) avisoVazio.style.display = 'block';
            else avisoVazio.style.display = 'none';
        }

        function copiarLinkGaleria(caminhoRelativo) {
            const urlBase = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
            const linkCompleto = urlBase + caminhoRelativo;
            navigator.clipboard.writeText(linkCompleto).then(() => {
                Swal.fire({title: 'Link copiado!', text: 'Cole no WhatsApp (Ctrl+V).', icon: 'success', confirmButtonColor: 'var(--cor-primaria)'});
            }).catch(err => { console.error("Erro ao copiar:", err); });
        }
