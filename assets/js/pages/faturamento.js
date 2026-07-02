        const sessaoString = localStorage.getItem('sinaliza_sessao');
        let currentUser = null; let currentRole = null;

        if (!sessaoString) {
            window.location.href = 'index.html';
        } else {
            try {
                const sessaoData = JSON.parse(sessaoString);
                currentUser = sessaoData.username; currentRole = sessaoData.role;
                if (currentRole !== 'faturamento' && currentRole !== 'admin') {
                    window.location.href = 'index.html';
                }
            } catch(e) { window.location.href = 'index.html'; }
        }

        const API_URL = '/api';
        const MY_ROLE = 'faturamento';

        let ordersData = [];
        let configData = { workflow: [], movementReasons: {} };
        let fatTeam = [];
        let currentFilter = 'Faturamento';

        // --- FUNÇÕES DA BARRA DE BUSCA ---
        function toggleClearBtn() {
            const input = document.getElementById('search-input');
            const btn = document.getElementById('clear-search-btn');
            if (input && btn) {
                btn.style.display = input.value.length > 0 ? 'block' : 'none';
            }
        }

        function clearSearch() {
            const input = document.getElementById('search-input');
            if (input) {
                input.value = '';
                toggleClearBtn();
                renderOrders(); 
            }
        }

        window.onload = async () => {
            loadTheme();
            if(currentUser) document.getElementById('user-name').innerText = currentUser.toUpperCase();
            await loadConfig();
            await loadTeam();
            await loadData();
            
            setInterval(backgroundSync, 60000); 
        };

        function logout() { localStorage.removeItem('sinaliza_sessao'); window.location.href = 'index.html'; }

        async function apiFetch(endpoint, method = 'GET', body = null) {
            const options = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) options.body = JSON.stringify(body);
            const res = await fetch(`${API_URL}${endpoint}`, options);
            if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || err.message || `Erro HTTP: ${res.status}`); }
            return res.json();
        }

        function safeParse(val) { if (typeof val === 'string') { try { return JSON.parse(val); } catch (e) { return val; } } return val; }
        function getSafeStatus(val) { return String(val || '').trim().toLowerCase(); }

        function mapOrder(dbOrder) {
            return {
                id: dbOrder.ID || dbOrder.id,
                client: dbOrder.CLIENTE || dbOrder.client,
                sales: dbOrder.VENDEDOR || dbOrder.sales,
                delivery: dbOrder.DATA_ENTREGA || dbOrder.delivery,
                status: dbOrder.STATUS || dbOrder.status,
                contact: dbOrder.CONTATO || dbOrder.contact,
                email: dbOrder.EMAIL || dbOrder.email,
                obs: dbOrder.OBS || dbOrder.obs,
                itemCount: dbOrder.ITEM_COUNT || dbOrder.item_count || '?',
                
                payment: dbOrder.PAGAMENTO || dbOrder.payment || 'Não Informado',
                shipping: dbOrder.FRETE || dbOrder.shipping || 'Retira / Padrão',

                issue_date: dbOrder.DATA_EMISSAO || dbOrder.issue_date,
                history: safeParse(dbOrder.HISTORY || dbOrder.history) || [],
                layoutData: safeParse(dbOrder.LAYOUT_DATA || dbOrder.layout_data) || null,
                prodData: safeParse(dbOrder.PROD_DATA || dbOrder.prod_data) || null,
                created_at: dbOrder.DATA_EMISSAO || dbOrder.created_at, 
                tipo_pedido: dbOrder.TIPO_PEDIDO || dbOrder.tipo_pedido
            };
        }

        function getTipoPedido(o) {
            let tp = String(o.tipo_pedido || '').toLowerCase().trim();
            if (tp && tp !== 'undefined' && tp !== 'normal' && tp !== 'convencional') return tp;
            if (Array.isArray(o.history)) {
                for (let h of o.history) {
                    if (h.obs) {
                        const obsLower = String(h.obs).toLowerCase();
                        if (obsLower.includes('urgente')) return 'urgente';
                        if (obsLower.includes('homologado')) return 'homologado';
                        if (obsLower.includes('projeto')) return 'projeto';
                    }
                }
            }
            return 'normal';
        }

        async function loadConfig() { 
            try { 
                const wf = await apiFetch('/config/workflow');
                if(wf && wf.dados) { let wData = wf.dados; if(typeof wData === 'string') wData = JSON.parse(wData); configData.workflow = wData; } 
                
                const mr = await apiFetch('/config/motivos');
                if(mr && mr.dados) { let mData = mr.dados; if(typeof mData === 'string') mData = JSON.parse(mData); configData.movementReasons = mData; }
            } catch(e){} 
        }

        async function loadTeam() {
            try {
                const users = await apiFetch('/usuarios');
                let dbUsers = users.filter(u => getSafeStatus(u.ROLE || u.role) === MY_ROLE).map(u => String(u.USERNAME || u.username).trim());
                fatTeam = [...new Set(dbUsers.filter(Boolean))];
                if(fatTeam.length === 0) fatTeam = ['Soraia']; 
            } catch(e) { 
                fatTeam = ['Soraia']; 
            }
        }

        async function loadData() { 
            const statusBadge = document.getElementById('db-status-badge');
            const statusText = document.getElementById('db-status-text');

            try {
                statusBadge.className = 'status-badge-top syncing'; statusText.innerHTML = 'Sincronizando... <i class="ph-bold ph-spinner ph-spin"></i>';
                const rawData = await apiFetch('/pedidos'); 
                statusBadge.className = 'status-badge-top online'; statusText.innerHTML = 'Conectado';

                const now = new Date();
                document.getElementById('last-update-text').innerText = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                if(rawData) { 
                    ordersData = rawData.map(mapOrder); 
                    if(currentFilter !== 'reports') renderOrders();
                    else renderRanking();
                } 
            } catch(e){
                statusBadge.className = 'status-badge-top offline'; statusText.innerHTML = 'Falha de Conexão';
            } 
        }

        async function sync() { 
            try { await SinalizaCore.triggerVPNSync(); Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Agente sincronizado!', showConfirmButton: false, timer: 2000 }); } catch(e){} 
            loadData(); 
        }

        function isUserInteracting() {
            const modals = document.querySelectorAll('.modal-overlay');
            for (let m of modals) {
                if (m.style.display === 'flex' || window.getComputedStyle(m).display === 'flex') return true;
            }
            if (document.querySelectorAll('.list-row.is-expanded').length > 0) return true;
            if (document.activeElement && document.activeElement.id === 'search-input' && document.activeElement.value !== '') return true;
            return false;
        }

        async function backgroundSync() {
            try {
                const rawData = await apiFetch('/pedidos'); 
                if(rawData) { 
                    ordersData = rawData.map(mapOrder); 
                    
                    const now = new Date();
                    const statusTxt = document.getElementById('last-update-text');
                    if(statusTxt) statusTxt.innerText = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    
                    if (!isUserInteracting()) {
                        if(currentFilter !== 'reports') renderOrders();
                        else renderRanking();
                    }
                } 
            } catch(e) {}
        }

        function switchTab(status) { 
            currentFilter = status;
            
            const viewDash = document.getElementById('view-dash');
            const viewReports = document.getElementById('view-reports');
            
            if(viewDash) viewDash.classList.add('hidden'); 
            if(viewReports) viewReports.classList.add('hidden'); 
            
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active')); 
            
            if(status === 'reports') {
                document.getElementById('btn-reports').classList.add('active');
                if(viewReports) viewReports.classList.remove('hidden');
                document.getElementById('page-title').innerText = "Relatórios de Faturamento";
                document.getElementById('page-subtitle').innerText = "Métricas e histórico de emissão de notas.";
                if (typeof renderRanking === 'function') renderRanking();
            } else if(status === 'Faturamento') {
                document.getElementById('btn-dash').classList.add('active');
                if(viewDash) viewDash.classList.remove('hidden');
                document.getElementById('page-title').innerText = "Setor de Faturamento";
                document.getElementById('page-subtitle').innerText = "Conferência de dados de expedição, arquivos e emissão de notas.";
                renderOrders();
            } else {
                document.getElementById('btn-done').classList.add('active');
                if(viewDash) viewDash.classList.remove('hidden');
                document.getElementById('page-title').innerText = "Pedidos Finalizados";
                document.getElementById('page-subtitle').innerText = "Histórico de ordens emitidas e concluídas.";
                renderOrders();
            }
        }

        window.toggleCard = function(id) {
            const row = document.getElementById(`row-${id}`); if (!row) return;
            const wasExpanded = row.classList.contains('is-expanded');
            document.querySelectorAll('.list-row.is-expanded').forEach(c => c.classList.remove('is-expanded'));
            if (!wasExpanded) row.classList.add('is-expanded');
        };

        function renderOrders() {
            const container = document.getElementById('orders-container');
            const kpiContainer = document.getElementById('kpi-container');
            const searchTerm = document.getElementById('search-input') ? document.getElementById('search-input').value.toLowerCase() : '';
            const sortValue = document.getElementById('sort-select') ? document.getElementById('sort-select').value : 'oldest';
            const typeFilter = document.getElementById('filter-type') ? document.getElementById('filter-type').value : 'all'; 
            
            let activeOrders = ordersData.filter(o => {
                const s = getSafeStatus(o.status);
                if (currentFilter === 'Faturamento') {
                    return s === 'faturamento' || s === 'em faturamento';
                }
                return s === getSafeStatus(currentFilter);
            });

            if (searchTerm) { activeOrders = activeOrders.filter(o => String(o.id).includes(searchTerm) || (o.client && o.client.toLowerCase().includes(searchTerm))); }

            if (typeFilter !== 'all') {
                activeOrders = activeOrders.filter(o => {
                    const tp = getTipoPedido(o);
                    if (typeFilter === 'normal') return tp === 'normal' || tp === 'convencional' || tp === '';
                    return tp === typeFilter;
                });
            }

            if(kpiContainer) {
                kpiContainer.innerHTML = `
                    <div class="kpi-card" style="border-color:var(--cor-primaria)"><div style="display:flex; align-items:center; gap:15px;"><div class="kpi-icon" style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria);"><i class="ph-fill ph-files"></i></div><div><span class="kpi-label">${currentFilter === 'Finalizado' ? 'Total Emitido' : 'Na Fila de Emissão'}</span><div class="kpi-val">${activeOrders.length}</div></div></div></div>
                `;
            }

            if(activeOrders.length === 0) { 
                container.innerHTML='<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado); background:var(--cor-card-bg); border-radius:16px; border:1px solid var(--cor-borda);"><i class="ph-fill ph-check-circle" style="font-size:4rem; margin-bottom:15px; opacity:0.3; color:var(--cor-sucesso);"></i><br><strong style="font-size:1.2rem; color:var(--cor-texto);">Fila Limpa!</strong></div>'; 
                return; 
            }

            activeOrders.sort((a,b) => {
                let sA = { dateStr: '9999-12-31' }, sB = { dateStr: '9999-12-31' };
                try { sA = SinalizaCore.calculateSLA(a) || sA; } catch(e){}
                try { sB = SinalizaCore.calculateSLA(b) || sB; } catch(e){}

                if (sortValue === 'recent') return new Date(b.created_at) - new Date(a.created_at);
                else if (sortValue === 'late') return new Date(sA.dateStr) - new Date(sB.dateStr);
                else return new Date(a.created_at) - new Date(b.created_at); 
            });

            container.innerHTML = activeOrders.map(o => createRowHTML(o)).join('');
        }

        function createRowHTML(o) {
            const stepsSafe = configData.workflow.map(x => getSafeStatus(x.name)); 
            const oStatusSafe = getSafeStatus(o.status);
            let idx = stepsSafe.indexOf(oStatusSafe); if(idx === -1) idx = 0; 
            
            let slaInfo = { status: 'normal', displayDate: 'N/D', dateStr: '9999-12-31' };
            try { slaInfo = SinalizaCore.calculateSLA(o) || slaInfo; } catch(e){}
            const isLate = slaInfo.status === 'late';

            const originalSteps = configData.workflow.map(x => x.name);
            let displaySteps = originalSteps;
            if(originalSteps.length > 5) {
                if(idx < 3) displaySteps = originalSteps.slice(0, 4);
                else if (idx >= originalSteps.length - 2) displaySteps = originalSteps.slice(originalSteps.length - 4);
                else displaySteps = originalSteps.slice(idx - 1, idx + 3);
            }

            const stepperHTML = displaySteps.map((stepName, i) => { 
                const realIdx = stepsSafe.indexOf(getSafeStatus(stepName));
                let cls = '', ico = ''; let stepDate = '';

                if (realIdx <= idx || currentFilter === 'Finalizado') {
                    const historyMoves = Array.isArray(o.history) ? o.history : [];
                    const move = [...historyMoves].reverse().find(h => getSafeStatus(h.to) === getSafeStatus(stepName));
                    if (move && move.date) { try { const d = new Date(move.date); if(!isNaN(d)) stepDate = String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); } catch(e){} } 
                    else if (realIdx === 0 && o.created_at) { try { const d = new Date(o.created_at); if(!isNaN(d)) stepDate = String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0'); } catch(e){} }
                }

                if (currentFilter === 'Finalizado' || realIdx < idx) { cls = 'done'; ico = '<i class="ph-bold ph-check"></i>'; } 
                else if (realIdx === idx) { cls = isLate ? 'active late' : 'active'; } 
                const hasLine = i < displaySteps.length - 1;
                
                return `<div class="stepper-item ${cls}"><span class="stepper-date">${stepDate}</span><div class="stepper-circle">${ico}</div><span class="stepper-label">${String(stepName).substring(0, 15)}</span>${hasLine ? '<div class="stepper-line"></div>' : ''}</div>`; 
            }).join('');

            let rowClass = "list-row";
            if(isLate && currentFilter !== 'Finalizado') rowClass += " late";

            let mainAction = '';
            let btnReturn = '';
            let btnExt = '';
            
            const stepComercial = configData.workflow.length > 0 ? configData.workflow[0].name : 'Comercial';
            const stepProd = configData.workflow.find(w => w.role === 'producao')?.name || 'Em Produção';

            if (currentFilter === 'Faturamento') {
                mainAction = `<button class="btn btn-success" style="height:36px; border-radius:6px; padding:0 16px;" onclick="event.stopPropagation(); openActionModal('${o.id}', 'Finalizado', 'next')"><i class="ph-bold ph-check-double"></i> Emitir NF / Finalizar</button>`;
                
                btnExt = `<button class="btn btn-warning btn-icon-only" style="height:36px; width:36px; padding:0; border-radius:6px; margin-right:4px;" onclick="event.stopPropagation(); openPrazoModal('${o.id}')" title="Registrar Problema/Atraso"><i class="ph-bold ph-warning" style="font-size:1.1rem;"></i></button>`;

                btnReturn = `
                <button class="btn btn-secondary btn-icon-only" style="height:36px; width:36px; padding:0; border-radius:6px; color:var(--cor-erro); border-color:var(--cor-erro);" onclick="event.stopPropagation(); openActionModal('${o.id}', '${stepProd}', 'back')" title="Devolver Produção"><i class="ph-bold ph-hammer" style="font-size:1.1rem;"></i></button>
                <button class="btn btn-secondary btn-icon-only" style="height:36px; width:36px; padding:0; border-radius:6px; color:var(--cor-alerta); border-color:var(--cor-alerta);" onclick="event.stopPropagation(); openActionModal('${o.id}', '${stepComercial}', 'back')" title="Devolver Comercial"><i class="ph-bold ph-briefcase" style="font-size:1.1rem;"></i></button>`;
            } else {
                mainAction = `<span style="color:var(--cor-sucesso); font-weight:800; display:flex; align-items:center; gap:6px;"><i class="ph-fill ph-check-circle" style="font-size:1.2rem;"></i> Concluído</span>`;
            }

            let tipo = getTipoPedido(o);
            let tagPrioridade = '';
            if (tipo === 'urgente') tagPrioridade = `<div class="tag-urgente"><i class="ph-fill ph-fire"></i> URGENTE</div>`;
            else if (tipo === 'homologado') tagPrioridade = `<div class="tag-homologado"><i class="ph-fill ph-star"></i> HOMOL</div>`;
            else if (tipo === 'projeto') tagPrioridade = `<div class="tag-projeto"><i class="ph-fill ph-blueprint"></i> PROJ</div>`;
            else tagPrioridade = `<div class="tag-normal"><i class="ph-fill ph-package"></i> NORMAL</div>`;

            let pesoExpedicao = o.prodData && o.prodData.pesoExpedicao ? `${o.prodData.pesoExpedicao} kg` : '<span style="color:var(--cor-erro)">Não Inf.</span>';
            let volumeExpedicao = o.prodData && o.prodData.volumeExpedicao ? o.prodData.volumeExpedicao : '<span style="color:var(--cor-erro)">Não Inf.</span>';

            let safeClient = o.client ? String(o.client).replace(/"/g, '&quot;') : '';

            let obsComercial = ''; let obsLayout = ''; let obsPCP = ''; let obsFaturamento = '';
            
            if(o.obs) { obsComercial = `<div class="obs-comercial"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-briefcase"></i> Briefing Comercial</div>${o.obs.replace(/\n/g, '<br>')}</div>`; }
            
            if(Array.isArray(o.history)) {
                const layoutHist = [...o.history].reverse().find(h => h.action.includes('Arte Finalizada') || h.action.includes('Projeto Finalizado'));
                if(layoutHist && layoutHist.obs) { obsLayout = `<div class="obs-layout"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-paint-brush"></i> Notas do Designer (${layoutHist.user})</div>${layoutHist.obs.replace(/\n/g, '<br>')}</div>`; }

                const pcpHist = [...o.history].reverse().find(h => h.action.includes('Liberação PCP') || h.action.includes('Avanço'));
                if(pcpHist && pcpHist.obs) { obsPCP = `<div class="obs-pcp"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-check-square-offset"></i> Notas Técnicas PCP (${pcpHist.user})</div>${pcpHist.obs.replace(/\n/g, '<br>')}</div>`; }

                if (currentFilter === 'Finalizado') {
                    const fatHist = [...o.history].reverse().find(h => h.action.includes('Faturamento Finalizado') || h.action.includes('Nota Emitida'));
                    if (fatHist && fatHist.obs) {
                        obsFaturamento = `<div class="obs-faturamento"><div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:6px; opacity:0.8;"><i class="ph-fill ph-receipt"></i> Nota de Faturamento (${fatHist.user})</div>${fatHist.obs.replace(/\n/g, '<br>')}</div>`;
                    }
                }
            }

            let blocoInteligenteObs = obsFaturamento + obsPCP + obsLayout + obsComercial;
            if(!blocoInteligenteObs) blocoInteligenteObs = '<div style="color:var(--cor-texto-mutado); font-style:italic; text-align:center; padding:20px;">Nenhuma observação técnica das etapas anteriores.</div>';

            return `
            <div class="${rowClass}" id="row-${o.id}">
                <div class="row-header" onclick="toggleCard('${o.id}')">
                    <div class="col-id">
                        <div class="row-id ${isLate && currentFilter !== 'Finalizado' ? 'late-id' : ''}" style="margin:0;">#${o.id}</div>
                        ${tagPrioridade}
                    </div>
                    <div class="col-client">
                        <div class="row-client" title="${safeClient}">${safeClient || 'N/D'}</div>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <span class="info-praz"><i class="ph-bold ph-calendar-blank"></i> Praz: <strong>${slaInfo.displayDate}</strong></span>
                            <span class="info-praz"><i class="ph-bold ph-package"></i> Itens: <strong style="color:var(--cor-primaria)">${o.itemCount || '?'}</strong></span>
                        </div>
                    </div>
                    <div class="col-stepper">
                        ${currentFilter === 'Faturamento' ? `<span class="info-status status-waiting" style="color:var(--cor-alerta);"><i class="ph-fill ph-clock"></i> Aguardando NF</span>` : ''}
                        <div class="stepper-wrapper">${stepperHTML}</div>
                    </div>
                    <div class="col-actions">
                        <div class="action-buttons">${btnReturn} ${btnExt} ${mainAction}</div>
                        <div class="btn-detalhes">Dados de Expedição <i class="ph-bold ph-caret-down"></i></div>
                    </div>
                </div>
                <div class="card-details" onclick="event.stopPropagation()">
                    <div style="display:grid; grid-template-columns: 1.5fr 1fr; gap:20px; margin-bottom:15px;">
                        <div class="obs-block" style="border-left: 4px solid var(--cor-primaria); background: var(--cor-primaria-soft-bg);">
                            <div style="font-size:0.8rem; font-weight:700; color:var(--cor-texto); text-transform:uppercase; margin-bottom:15px; border-bottom:1px solid var(--cor-borda); padding-bottom:8px;"><i class="ph-fill ph-currency-dollar"></i> Financeiro & Expedição</div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                                <div>
                                    <div style="font-size:0.85rem; margin-bottom:8px; color:var(--cor-texto-mutado)"><strong>Vendedor:</strong> <span style="color:var(--cor-texto)">${o.sales}</span></div>
                                    <div style="font-size:0.85rem; margin-bottom:8px; color:var(--cor-texto-mutado)"><strong>Pagamento:</strong> <span style="color:var(--cor-texto)">${o.payment}</span></div>
                                    <div style="font-size:0.85rem; color:var(--cor-texto-mutado)"><strong>Transporte:</strong> <span style="color:var(--cor-texto)">${o.shipping}</span></div>
                                </div>
                                <div style="border-left: 1px dashed var(--cor-primaria-border); padding-left: 15px;">
                                    <div style="font-size:0.85rem; margin-bottom:8px; color:var(--cor-primaria);"><strong>Peso (Produção):</strong> <span style="color:var(--cor-texto)">${pesoExpedicao}</span></div>
                                    <div style="font-size:0.85rem; color:var(--cor-primaria);"><strong>Volumes:</strong> <span style="color:var(--cor-texto)">${volumeExpedicao}</span></div>
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; flex-direction: column; justify-content: center; gap: 15px;">
                            <button class="btn btn-secondary" style="width: 100%; height: 50px; font-size: 0.95rem;" onclick="openFilesModal('${o.id}')">
                                <i class="ph-fill ph-folder-open" style="font-size:1.3rem; color:var(--cor-primaria);"></i> Ver Documentos
                            </button>
                            <button class="btn btn-secondary" style="width: 100%; height: 50px; font-size: 0.95rem;" onclick="openHistoryModal('${o.id}')">
                                <i class="ph-fill ph-clock-counter-clockwise" style="font-size:1.3rem; color:var(--cor-texto);"></i> Ver Auditoria Completa
                            </button>
                        </div>
                    </div>
                    <div class="obs-block">
                        <div style="font-size:0.8rem; font-weight:700; color:var(--cor-texto); text-transform:uppercase; margin-bottom:15px; border-bottom:1px solid var(--cor-borda); padding-bottom:8px;"><i class="ph-fill ph-list-checks"></i> Observações Técnicas das Etapas</div>
                        ${blocoInteligenteObs}
                    </div>
                </div>
            </div>`;
        }

        function openActionModal(id, next, type) { 
            document.getElementById('modal-id').value = id; document.getElementById('modal-new-status').value = next; document.getElementById('modal-move-type').value = type;
            document.getElementById('modal-obs').value = ''; 
            
            const reasonSelect = document.getElementById('modal-reason-select'); reasonSelect.innerHTML = '<option value="">Selecione o motivo da movimentação...</option>';
            let availableReasons = [];
            if (configData.movementReasons && configData.movementReasons[MY_ROLE]) {
                const direction = type === 'next' ? 'forward' : 'backward';
                availableReasons = configData.movementReasons[MY_ROLE][direction] || [];
            }
            if (availableReasons.length === 0) availableReasons = ['Faturamento Concluído'];
            availableReasons.forEach(r => { reasonSelect.innerHTML += `<option value="${r}">${r}</option>`; });

            const t = document.getElementById('modal-title'); const d = document.getElementById('modal-desc'); const b = document.getElementById('btn-confirm-action'); 

            if(type === 'next'){
                t.innerHTML='<i class="ph-fill ph-check-double" style="color:var(--cor-sucesso)"></i> Emitir NF / Concluir'; 
                d.innerHTML=`Confirma a emissão e encerramento do pedido <b>#${id}</b>?`; 
                b.className='btn btn-success'; b.innerHTML = '<i class="ph-bold ph-check"></i> Finalizar Pedido';
            } else {
                t.innerHTML=`<i class="ph-fill ph-arrow-u-up-left" style="color:var(--cor-erro)"></i> Devolver Pedido`; 
                d.innerHTML=`Ocorreu algum erro nos dados ou no material? O projeto voltará para <b>${next}</b>.`; 
                b.className='btn btn-danger'; b.innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i> Devolver';
            } 
            document.getElementById('actionModal').style.display = 'flex'; 
        }
        
        async function confirmAction() { 
            const id = document.getElementById('modal-id').value; 
            const next = document.getElementById('modal-new-status').value; 
            const type = document.getElementById('modal-move-type').value;
            const reason = document.getElementById('modal-reason-select').value;
            const obsText = document.getElementById('modal-obs').value; 
            
            if (!reason) return Swal.fire("Atenção", "Selecione um motivo na lista.", "warning");

            const btn = document.getElementById('btn-confirm-action'); 
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Processando...'; btn.disabled = true;

            const o = ordersData.find(x => x.id == id); 
            const isReturn = type === 'back'; 
            const nomeOperador = currentUser || 'Faturamento';

            const actionName = isReturn ? 'Devolução Faturamento' : 'Faturamento Finalizado';
            
            // Grava o motivo no formato [Motivo: xxxx] para o relatório puxar corretamente
            const finalObs = obsText ? `[Motivo: ${reason}] - ${obsText}` : `[Motivo: ${reason}]`;

            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry(actionName, next, nomeOperador, reason, finalObs)]; 
            let updatePayload = { status: next, history: newHistory, ...SinalizaCore.gerarTimestamps(o.status, next) };

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', updatePayload);
                document.getElementById('actionModal').style.display='none'; 
                Swal.fire({toast:true, position:'top-end', icon:'success', title:isReturn ? 'Devolvido com sucesso' : 'Pedido Concluído e Arquivado!', showConfirmButton:false, timer:3000});
                loadData(); 
            } catch(e) { Swal.fire('Erro Técnico', e.message, 'error'); } 
            finally { btn.innerHTML = originalText; btn.disabled = false; }
        }

        function closeModal() { document.getElementById('actionModal').style.display='none'; }

        // --- LÓGICA DO NOVO MODAL DE ATRASO DO FATURAMENTO ---
        function openPrazoModal(id) {
            document.getElementById('prazo-id').value = id;
            document.getElementById('prazo-motivo').selectedIndex = 0;
            document.getElementById('prazo-detalhes').value = '';
            document.getElementById('prazoModal').style.display = 'flex';
        }

        async function confirmPrazo() {
            const id = document.getElementById('prazo-id').value;
            const motivo = document.getElementById('prazo-motivo').value;
            const detalhes = document.getElementById('prazo-detalhes').value;
            const o = ordersData.find(x => x.id == id); if(!o) return;

            const nomeOperador = currentUser || 'Faturamento';
            
            // Grava com a mesma estrutura [Motivo: xxxx]
            const msgHist = detalhes ? `Motivo: ${motivo}. Detalhes: ${detalhes}` : `Motivo: ${motivo}`;
            
            // Adiciona a ação "Problema Faturamento" no histórico
            const newHistory = [...(o.history || []), SinalizaCore.buildHistoryEntry('Problema Faturamento', o.status, nomeOperador, '', msgHist)];

            const btn = document.querySelector('#prazoModal .btn-warning');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Registrando...';
            btn.disabled = true;

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', { history: newHistory });
                document.getElementById('prazoModal').style.display = 'none';
                Swal.fire({toast:true, position:'top-end', icon:'success', title:`Problema registrado!`, showConfirmButton:false, timer:3000});
                loadData();
            } catch(e) { Swal.fire('Erro', 'Falha ao registrar: ' + e.message, 'error'); 
            } finally { btn.innerHTML = originalText; btn.disabled = false; }
        }

        async function abrirPreview(id) { openFilesModal(id); }

        async function openFilesModal(id) {
            document.getElementById('modal-order-id').innerText = '#' + id;
            document.getElementById('filesModal').style.display = 'flex';
            
            const list = document.getElementById('file-list-container');
            const preview = document.getElementById('preview-container');
            
            list.innerHTML = '<div style="padding:40px;text-align:center;color:var(--cor-texto-mutado);"><i class="ph-bold ph-spinner ph-spin" style="font-size:3rem; margin-bottom:15px; color:var(--cor-primaria);"></i><br><strong style="font-size:1.1rem;">Acessando Rede...</strong></div>';
            preview.innerHTML = '<div style="color:var(--cor-texto-mutado); display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; font-weight:600;"><i class="ph-fill ph-image" style="font-size:5rem; margin-bottom:20px; opacity:0.2;"></i> Selecione um arquivo</div>';

            try {
                const arquivosBrutos = await SinalizaCore.fetchFilesFromVPN(id);
                if(!arquivosBrutos || arquivosBrutos.length === 0) { list.innerHTML = '<div style="padding:40px; text-align:center; color:var(--cor-texto-mutado);"><i class="ph-fill ph-empty" style="font-size:3rem; margin-bottom:15px;"></i><br><strong>Pasta física vazia.</strong></div>'; return; }

                list.innerHTML = '';
                arquivosBrutos.forEach(f => {
                    const item = document.createElement('div'); item.className = 'file-item';
                    let icon = 'ph-file';
                    if(f.ext === 'pdf') icon = 'ph-file-pdf'; else if(['jpg','jpeg','png','gif','webp'].includes(f.ext)) icon = 'ph-image'; else if(['xls','xlsx','csv'].includes(f.ext)) icon = 'ph-file-xls';
                    const badge = f.folder.toLowerCase().replace(/[\u0300-\u036f]/g, "");
                    
                    item.innerHTML = `<div style="display:flex; align-items:center; gap:8px; overflow:hidden;"><i class="ph-fill ${icon}" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f.name}">${f.name}</span></div><span class="file-chip chip-${badge}">${f.folder}</span>`;
                    
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
            } catch(e) { list.innerHTML = `<div style="padding:40px; text-align:center; color:var(--cor-erro);"><i class="ph-fill ph-warning-circle" style="font-size:2.5rem; margin-bottom:10px;"></i><br><b>Erro de VPN. O Agente local parece estar offline.</b></div>`; }
        }
        function closeFilesModal() { document.getElementById('filesModal').style.display = 'none'; document.getElementById('preview-container').innerHTML = ''; }

        function openHistoryModal(id) {
            const o = ordersData.find(x => String(x.id) === String(id)); if(!o) return; document.getElementById('hist-order-id').innerText = '#' + id; const container = document.getElementById('history-container'); container.innerHTML = '';
            if (!o.history || o.history.length === 0) { container.innerHTML = '<div style="text-align:center; padding: 50px 20px; color:var(--cor-texto-mutado);"><i class="ph-fill ph-ghost" style="font-size:3.5rem; margin-bottom:10px; opacity:0.3;"></i><br><strong style="font-size:0.95rem;">Sem Histórico!</strong></div>'; } 
            else {
                const histRev = [...o.history].reverse();
                histRev.forEach((h, index) => {
                    const dateObj = new Date(h.date); const dateStr = dateObj.toLocaleDateString('pt-BR') + ' às ' + dateObj.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
                    
                    let actionBadge = ''; 
                    if(h.action.includes('Faturamento') && !h.action.includes('Devolu')) { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else if(h.action.includes('Iniciad') || h.action.includes('Produção Finalizada')) { actionBadge = `<span style="background:rgba(14, 165, 233, 0.15); color:#0ea5e9; padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else if(h.action.includes('Arte')) { actionBadge = `<span style="background:rgba(168, 85, 247, 0.15); color:#a855f7; padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else if(h.action.includes('Problema') || h.action.includes('Atraso')) { actionBadge = `<span style="background:var(--warning-bg); color:var(--cor-alerta); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; } 
                    else if(h.action.includes('Admin') || h.action.includes('Bypass') || h.action.includes('Massa')) { actionBadge = `<span style="background:var(--warning-bg); color:var(--cor-alerta); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; } 
                    else if(h.action.includes('Reprovação') || h.action.includes('Retorno') || h.action.includes('Devolu')) { actionBadge = `<span style="background:var(--danger-bg); color:var(--cor-erro); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">${h.action.toUpperCase()}</span>`; }
                    else { actionBadge = `<span style="background:var(--cor-primaria-soft-bg); color:var(--cor-sucesso); padding:2px 6px; border-radius:4px; font-size:0.65rem; font-weight:700;">MOVIMENTAÇÃO</span>`; }
                    
                    let obsHtml = h.obs ? `<div style="font-size: 0.9rem; color: var(--cor-texto); margin-top: 8px; background: var(--cor-card-bg); padding: 12px; border-radius: 8px; border-left: 3px solid var(--cor-primaria); font-weight: 500;">${h.obs.replace(/\n/g, '<br>')}</div>` : ''; let isCurrent = index === 0 ? `<span style="color:white; font-size:0.65rem; background:var(--cor-primaria); padding:2px 6px; border-radius:4px; margin-left:auto; font-weight:700;">ETAPA ATUAL</span>` : '';
                    container.innerHTML += `<div class="history-item"><div class="history-date"><i class="ph-bold ph-calendar-blank"></i> ${dateStr} ${isCurrent}</div><div class="history-title"><i class="ph-fill ph-user-circle" style="font-size:1.3rem; color:var(--cor-texto-mutado);"></i> <span style="font-weight:700; font-size:0.95rem;">${h.user || 'Sistema'}</span> <i class="ph-bold ph-arrow-right" style="color:var(--cor-texto-mutado)"></i> <span style="text-decoration: underline; text-decoration-color: var(--cor-primaria); text-decoration-thickness: 2px;">${h.to}</span> ${actionBadge}</div>${obsHtml}</div>`;
                });
            } document.getElementById('historyModal').style.display = 'flex';
        }
        function closeHistoryModal() { document.getElementById('historyModal').style.display = 'none'; }

        // ==============================================================
        // 🛡️ LÓGICA DE RELATÓRIOS DO FATURAMENTO E MOTIVOS DE ATRASO
        // ==============================================================
        function renderRanking() { 
            const rankingGrid = document.getElementById('ranking-grid'); 
            const distDiv = document.getElementById('designer-distribution'); 
            const funnelGrid = document.getElementById('micro-funnel-grid');

            if (!rankingGrid) return;

            const stats = {}; 
            const delayStats = { byReason: {} };
            const returnStats = { byReason: {} };
            
            const myStages = configData.workflow.filter(s => getSafeStatus(s.role).includes(MY_ROLE) || getSafeStatus(s.name).includes(MY_ROLE)).map(s => getSafeStatus(s.name)); 
            if(myStages.length === 0) myStages.push('faturamento');

            let totalFilaMins = 0; let countFila = 0;
            let completedDates = [];

            function normalizarNome(nome) {
                if(!nome || String(nome).trim().toLowerCase() === 'sistema') return fatTeam[0] || 'Soraia';
                const n = String(nome).trim();
                return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
            }

            const mainUser = normalizarNome(fatTeam.length > 0 ? fatTeam[0] : 'Soraia');
            stats[mainUser] = { count: 0, totalMins: 0 };

            ordersData.forEach(o => { 
                const logs = o.history || [];

                // Lógica de Problemas de Faturamento
                const logsAtraso = logs.filter(h => h.action === 'Problema Faturamento' || h.action === 'Justificativa Registrada');
                logsAtraso.forEach(log => {
                    const match = String(log.obs).match(/Motivo:\s*([^.]+)/i);
                    const reason = match && match[1] ? match[1].trim() : 'Problema Operacional';
                    delayStats.byReason[reason] = (delayStats.byReason[reason] || 0) + 1;
                });

                // Lógica de Retornos (Devolução)
                const logsRetorno = logs.filter(h => h.action === 'Devolução Faturamento');
                logsRetorno.forEach(log => {
                    const match = String(log.obs).match(/\[Motivo:\s*([^\]]+)\]/i);
                    const reason = match && match[1] ? match[1].trim() : 'Dados Incorretos';
                    returnStats.byReason[reason] = (returnStats.byReason[reason] || 0) + 1;
                });

                // Momento que caiu no faturamento
                const entryLog = logs.find(h => myStages.includes(getSafeStatus(h.to)));
                if (!entryLog) return; 

                let entryTime = new Date(entryLog.date);
                if (isNaN(entryTime.getTime())) return;

                const isActive = myStages.includes(getSafeStatus(o.status));

                const exitLog = [...logs].reverse().find(h => {
                    const hDate = new Date(h.date);
                    if (hDate < entryTime) return false;
                    const act = String(h.action || '').toLowerCase();
                    const fromStatus = getSafeStatus(h.from);
                    const toStatus = getSafeStatus(h.to);
                    
                    if (act.includes('faturamento finalizado') || act.includes('nota emitida')) return true;
                    if (myStages.includes(fromStatus) && !myStages.includes(toStatus) && !act.includes('retorno') && !act.includes('devolu')) return true;
                    return false;
                });

                if (isActive) {
                    const filaMins = (new Date() - entryTime) / 60000;
                    if (filaMins >= 0 && filaMins < 43200) { totalFilaMins += filaMins; countFila++; }
                } else {
                    if (exitLog) {
                        const exitTime = new Date(exitLog.date);
                        completedDates.push(exitTime);

                        let workerName = mainUser;
                        if(exitLog.user && String(exitLog.user).toLowerCase() !== 'sistema') {
                            workerName = normalizarNome(exitLog.user);
                        }

                        if (!stats[workerName]) stats[workerName] = { count: 0, totalMins: 0 };
                        
                        stats[workerName].count++;
                        
                        const fullTime = (exitTime - entryTime) / 60000;
                        if (fullTime >= 0 && fullTime < 43200) {
                            stats[workerName].totalMins += fullTime;
                            totalFilaMins += fullTime; 
                            countFila++;
                        }
                    }
                }
            });

            let mediaPorDia = 0;
            let mediaPorMes = 0;
            if (completedDates.length > 0) {
                completedDates.sort((a,b) => a - b);
                const firstDate = completedDates[0];
                const lastDate = completedDates[completedDates.length - 1];
                let diffDays = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
                if (diffDays < 1) diffDays = 1; 
                
                mediaPorDia = completedDates.length / diffDays;
                mediaPorMes = mediaPorDia * 30;
            }

            if (funnelGrid) {
                function formatCompactFunnel(mins) {
                    if (!mins || mins < 1) return '0m';
                    if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                    if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                    return `${Math.round(mins)}m`;
                }

                const avgFila = countFila > 0 ? (totalFilaMins / countFila) : 0;

                funnelGrid.style.gridTemplateColumns = "repeat(auto-fit, minmax(250px, 1fr))";
                funnelGrid.innerHTML = `
                <div style="background:var(--cor-card-bg); border:1px solid var(--cor-borda); border-radius:var(--radius-card); padding:20px; box-shadow:var(--sombra-sm); border-top: 4px solid var(--cor-texto-mutado);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-weight:700; color:var(--cor-texto); text-transform:uppercase; font-size:0.85rem;">Tempo Médio de Fila / Emissão</div>
                        <div style="background:var(--cor-panel-bg); color:var(--cor-texto-mutado); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;"><i class="ph-fill ph-clock"></i></div>
                    </div>
                    <div style="font-size:1.8rem; font-weight:800; color:var(--cor-texto);">${formatCompactFunnel(avgFila)}</div>
                    <div style="font-size:0.75rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase; margin-top:4px;">Aguardando liberação de NF</div>
                </div>
                
                <div style="background:var(--cor-card-bg); border:1px solid var(--cor-borda); border-radius:var(--radius-card); padding:20px; box-shadow:var(--sombra-sm); border-top: 4px solid var(--cor-sucesso);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <div style="font-weight:700; color:var(--cor-texto); text-transform:uppercase; font-size:0.85rem;">Volume de Notas Emitidas</div>
                        <div style="background:#D1FAE5; color:var(--cor-sucesso); width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.2rem;"><i class="ph-fill ph-check-circle"></i></div>
                    </div>
                    <div style="display:flex; gap: 30px;">
                        <div>
                            <div style="font-size:1.6rem; font-weight:800; color:var(--cor-texto);">${mediaPorDia.toFixed(1)}</div>
                            <div style="font-size:0.75rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Por Dia</div>
                        </div>
                        <div>
                            <div style="font-size:1.6rem; font-weight:800; color:var(--cor-texto);">${mediaPorMes.toFixed(0)}</div>
                            <div style="font-size:0.75rem; color:var(--cor-texto-mutado); font-weight:600; text-transform:uppercase;">Por Mês (Proj.)</div>
                        </div>
                    </div>
                </div>`;
            }

            let distHTML = ''; 
            for (const [name, d] of Object.entries(stats)) {
                if (d.count > 0 || name === mainUser) {
                    distHTML += `<span class="designer-pill" style="border-color:var(--cor-primaria);">${name} <span class="designer-count" style="background:var(--cor-primaria);">${d.count}</span></span>`; 
                }
            }
            if (distDiv) distDiv.innerHTML = distHTML; 

            if (rankingGrid) {
                rankingGrid.innerHTML = ''; 
                const sorted = Object.keys(stats).sort((a,b) => stats[b].count - stats[a].count); 
                
                const champion = sorted[0]; 
                sorted.forEach(user => { 
                    const data = stats[user]; 
                    if(data.count === 0) return;

                    const avgMins = data.count > 0 ? (data.totalMins / data.count) : 0; 
                    
                    let avgStr = '';
                    if (avgMins >= 1440) {
                        avgStr = `${(avgMins / 1440).toFixed(1)} dias`;
                    } else if (avgMins >= 60) {
                        avgStr = `${(avgMins / 60).toFixed(1)} h`;
                    } else {
                        avgStr = `${Math.round(avgMins)} min`;
                    }

                    const level = Math.floor(data.count/10)+1; 
                    const progress = ((data.count%10)/10)*100; 
                    let badges = ''; 
                    if(user === champion && data.count > 0) badges += `<div style="color:var(--cor-alerta); font-size:2rem; text-align:center; margin-top:15px;" title="Líder de Emissões"><i class="ph-fill ph-trophy"></i></div>`; 
                    
                    rankingGrid.innerHTML += `
                    <div class="gamer-card">
                        <div class="gamer-header">
                            <div class="avatar-circle">${user.charAt(0).toUpperCase()}</div>
                            <div style="font-weight:800; font-size:1.1rem;">${user}</div>
                            <div style="font-size:0.75rem; opacity:0.9; font-weight:600; margin-top:4px;">NÍVEL ${level}</div>
                        </div>
                        <div class="gamer-body">
                            <div class="stat-row"><span style="color:var(--cor-texto-mutado); font-size:0.85rem; font-weight:600;">Notas Emitidas</span><span style="font-weight:700; color:var(--cor-texto); font-size:1rem;">${data.count}</span></div>
                            <div class="stat-row"><span style="color:var(--cor-texto-mutado); font-size:0.85rem; font-weight:600;">SLA de Emissão</span><span style="font-weight:700; color:var(--cor-texto); font-size:1rem;">${avgStr}</span></div>
                            <div class="xp-bar-container"><div class="xp-bar-fill" style="width:${progress}%"></div></div>
                            ${badges}
                        </div>
                    </div>`; 
                }); 
            }

            // RENDERIZAÇÃO DOS LISTADOS DE MOTIVOS
            const motivosAtrasoList = document.getElementById('motivos-atraso-list');
            if (motivosAtrasoList) {
                const sortedAtrasos = Object.entries(delayStats.byReason).sort((a,b) => b[1] - a[1]);
                if(sortedAtrasos.length === 0) {
                    motivosAtrasoList.innerHTML = '<div style="color:var(--cor-sucesso); font-size:0.95rem; font-weight:600; padding:10px 0; display:flex; align-items:center; gap:8px;"><i class="ph-fill ph-check-circle" style="font-size:1.2rem;"></i> Nenhum problema reportado.</div>';
                } else {
                    motivosAtrasoList.innerHTML = sortedAtrasos.map(m => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--cor-borda); font-size:0.9rem;">
                            <span style="color:var(--cor-texto); font-weight:600;">${m[0]}</span>
                            <span style="background:var(--warning-bg); color:var(--cor-alerta); padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.8rem;">${m[1]} ocorrências</span>
                        </div>
                    `).join('');
                }
            }

            const motivosRetornoList = document.getElementById('motivos-retorno-list');
            if (motivosRetornoList) {
                const sortedRetornos = Object.entries(returnStats.byReason).sort((a,b) => b[1] - a[1]);
                if(sortedRetornos.length === 0) {
                    motivosRetornoList.innerHTML = '<div style="color:var(--cor-sucesso); font-size:0.95rem; font-weight:600; padding:10px 0; display:flex; align-items:center; gap:8px;"><i class="ph-fill ph-check-circle" style="font-size:1.2rem;"></i> Nenhuma devolução realizada.</div>';
                } else {
                    motivosRetornoList.innerHTML = sortedRetornos.map(m => `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px dashed var(--cor-borda); font-size:0.9rem;">
                            <span style="color:var(--cor-texto); font-weight:600;">${m[0]}</span>
                            <span style="background:var(--danger-bg); color:var(--cor-erro); padding:2px 8px; border-radius:4px; font-weight:700; font-size:0.8rem;">${m[1]} devoluções</span>
                        </div>
                    `).join('');
                }
            }
        }

        function toggleTheme() { const b=document.body; const c=b.getAttribute('data-theme'); const n=c==='dark'?'light':'dark'; b.setAttribute('data-theme',n); localStorage.setItem('theme',n); updateThemeIcon(n); }
        function loadTheme() { const t=localStorage.getItem('theme')||'light'; document.body.setAttribute('data-theme',t); updateThemeIcon(t); }
        function updateThemeIcon(t) { const i=document.getElementById('theme-icon'); const txt = document.getElementById('theme-text'); if(t==='dark'){i.className='ph-fill ph-sun';txt.innerText='Modo Claro';}else{i.className='ph-fill ph-moon';txt.innerText='Modo Escuro';} }
