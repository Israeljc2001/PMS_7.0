// ====================================================
        // 🔒 BLOQUEIO DE SEGURANÇA E SESSÃO
        // ====================================================
        const sessaoString = localStorage.getItem('sinaliza_sessao');
        let currentUser = null;
        let currentRole = null;
        let selectedAdminReopenOrderId = null;

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

        function isCurrentAdmin() {
            return getSafeStatus(currentRole) === 'admin';
        }

        function scrollToTop() {
            const mainContent = document.getElementById('main-content');
            if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function logout() {
            localStorage.removeItem('sinaliza_sessao'); 
            window.location.href = 'index.html';        
        }
        
        const API_URL = '/api';

        let ordersData = [];
        let configData = { workflow: [], movementReasons: {} }; 
        let usersData = [];
        const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
        let paymentChart, clientsChart, statusChart, dailyChart;

        window.onload = async () => {
            loadTheme();
            setupAdminOnlyControls();
            if(currentUser) {
                const userEl = document.getElementById('user-name');
                if(userEl) userEl.innerText = String(currentUser).toUpperCase();
                const topbarUserEl = document.getElementById('topbar-user-name');
                if(topbarUserEl) topbarUserEl.innerText = String(currentUser).toUpperCase();
            }
            await loadConfig();
            await loadData();
            
            setInterval(loadData, 60000); 

            const mainContent = document.getElementById('main-content');
            const scrollBtn = document.getElementById('scrollTopBtn');
            const updateScrollButton = () => {
                if (!scrollBtn) return;
                const internalScroll = mainContent ? mainContent.scrollTop : 0;
                const pageScroll = window.scrollY || document.documentElement.scrollTop || 0;
                if (internalScroll > 260 || pageScroll > 260) scrollBtn.classList.add('visible');
                else scrollBtn.classList.remove('visible');
            };

            if (mainContent) mainContent.addEventListener('scroll', updateScrollButton, { passive: true });
            window.addEventListener('scroll', updateScrollButton, { passive: true });
            updateScrollButton();
        };

        function getSafeStatus(val) {
            return String(val || '').trim().toLowerCase();
        }

        // ====================================================
        // 🛡️ A MÁQUINA DE RESGATE DE STATUS
        // Avalia o histórico real para descobrir onde o pedido parou
        // ====================================================
        function getRealOrderStage(o, finalStage) {
            let st = getSafeStatus(o.status);
            if (o.history && o.history.length > 0) {
                const lastLog = o.history[o.history.length - 1];
                if (lastLog.to) st = getSafeStatus(lastLog.to);
            }
            if (st === 'finalizado' || st === 'concluido' || st === 'entregue') {
                return finalStage || 'finalizado';
            }
            return st;
        }
        
        function getLayoutMicroStep(o) {
            const logs = [...(o.history || [])].reverse();
            for (const h of logs) {
                const act = String(h.action || '').toLowerCase();
                if (act === 'cliente aprovou') return 3; 
                if (act === 'enviado ao cliente') return 2; 
                if (act === 'layout iniciado' || act === 'cliente reprovou' || act.includes('início') || act.includes('inicio')) return 1; 
            }
            return 0; 
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
                itemCount: dbOrder.ITEM_COUNT || dbOrder.item_count,
                payment: dbOrder.PAGAMENTO || dbOrder.payment,
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

        async function loadConfig() {
            try {
                const wf = await apiFetch('/config/workflow');
                if(wf && wf.dados) {
                    let wData = wf.dados;
                    if(typeof wData === 'string') wData = JSON.parse(wData);
                    
                    configData.workflow = wData.map(w => ({
                        name: w.name,
                        role: w.role || w.sector || 'admin', 
                        sla: w.sla || 24,
                        canReturn: w.canReturn !== undefined ? w.canReturn : (w.return !== undefined ? w.return : true)
                    }));
                } else {
                    configData.workflow = [];
                }

                const mr = await apiFetch('/config/motivos');
                if(mr && mr.dados) {
                    let mData = mr.dados;
                    if(typeof mData === 'string') mData = JSON.parse(mData);
                    configData.movementReasons = mData;
                } else {
                    configData.movementReasons = {};
                }

                if(!configData.workflow || configData.workflow.length === 0) return; 
                renderConfigTable(); 
                renderReasonsConfig();
                updateFilterOptions(); 
                updateBulkOptions();
            } catch(e) { console.error("Erro config:", e); }
        }

        async function loadData() {
            const statusBadge = document.getElementById('db-status-badge');
            const statusText = document.getElementById('db-status-text');
            const lastUpdateText = document.getElementById('last-update-text');

            try {
                statusBadge.className = 'status-badge-top syncing';
                statusText.innerHTML = 'Sincronizando... <i class="ph ph-spinner ph-spin"></i>';

                const rawData = await apiFetch('/pedidos');
                
                statusBadge.className = 'status-badge-top online';
                statusText.innerHTML = 'Conectado';
                
                const now = new Date();
                lastUpdateText.innerText = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

                if (rawData) {
                    ordersData = rawData.map(mapOrder);
                    if (configData.workflow && configData.workflow.length > 0) {
                        updateKPIs();
                        renderOrders();
                        if(!document.getElementById('view-sales').classList.contains('hidden')) { populateSalesPersonFilter(); renderSalesDashboard(); }
                        if(!document.getElementById('view-reports').classList.contains('hidden')) renderReports();
                        if(!document.getElementById('view-gargalos').classList.contains('hidden')) processAdminBottlenecks();
                        if(!document.getElementById('view-orders-base').classList.contains('hidden')) renderAdminOrdersBase();
                    }
                }
            } catch(e) {
                console.error("Erro ao carregar pedidos:", e);
                statusBadge.className = 'status-badge-top offline';
                statusText.innerHTML = 'Falha de Conexão';
            }
        }

        async function forceReload() {
            const btn = document.getElementById('btn-sync');
            if (btn) btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
            await loadData();
            if (btn) btn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Sincronizar';
        }

        function populateSalesPersonFilter() {
            const sel = document.getElementById('sales-person-filter');
            const currentVal = sel.value;
            const sellers = [...new Set(ordersData.map(o => o.sales ? o.sales.trim() : 'N/D'))].sort();
            let html = `<option value="all">👥 Todos os Vendedores</option>`;
            sellers.forEach(s => { if(s && s !== 'N/D') html += `<option value="${s}">${s}</option>`; });
            sel.innerHTML = html; sel.value = currentVal;
        }

        function getFilteredSalesData() {
            const period = document.getElementById('sales-period-filter').value;
            const person = document.getElementById('sales-person-filter').value;
            const now = new Date(); let startDate = new Date(); let endDate = new Date();
            
            if (period === 'this_month') { startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0); endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); } 
            else if (period === 'last_month') { startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0); endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); } 
            else if (period === 'this_year') { startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0); endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59); } 
            else { startDate = new Date(2000, 0, 1); endDate = new Date(2100, 0, 1); }

            return ordersData.filter(o => {
                if (person !== 'all' && (!o.sales || o.sales !== person)) return false;
                
                let rawDate = o.issue_date || o.created_at; 
                if (!rawDate) return false;
                
                if (typeof rawDate === 'string' && rawDate.length === 10) rawDate += 'T12:00:00';
                const orderDate = new Date(rawDate);
                
                return orderDate >= startDate && orderDate <= endDate;
            });
        }

        function renderSalesDashboard() {
            const filteredData = getFilteredSalesData();
            const container = document.getElementById('sales-kpi-container');
            const tableBody = document.getElementById('sales-table-body');
            const periodSelect = document.getElementById('sales-period-filter');
            const personSelect = document.getElementById('sales-person-filter');
            
            const period = periodSelect.value;
            const person = personSelect.value;
            
            const pText = periodSelect.options[periodSelect.selectedIndex].text;
            const sText = personSelect.options[personSelect.selectedIndex].text;
            
            const infoLabel = document.getElementById('sales-info-label');
            if (infoLabel) infoLabel.innerText = `Filtro Ativo: ${pText} • ${sText} (${filteredData.length} resultados)`;

            // ====================================================================
            // 🚀 CÓPIA LITERAL DA LÓGICA DO COMERCIAL.HTML (updateKPIs)
            // ====================================================================
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

            // Simula a variável "currentUser" do Comercial extraindo o nome do Dropdown
            let simulatedCurrentUser = person;
            if (simulatedCurrentUser !== 'all' && simulatedCurrentUser.includes('(')) {
                simulatedCurrentUser = simulatedCurrentUser.split('(')[0].trim();
            }

            ordersData.forEach(o => {
                const val = parseFloat(o.value || 0);

                // Emula a função isOwner(o.sales) do Comercial
                let isOwnerOrder = false;
                if (person === 'all') {
                    isOwnerOrder = true;
                } else {
                    const orderSalesName = o.sales || '';
                    if (orderSalesName && simulatedCurrentUser && orderSalesName.toLowerCase().includes(simulatedCurrentUser.toLowerCase())) {
                        isOwnerOrder = true;
                    }
                }

                // 1. MÉTRICA DE VENDAS
                let dataVendaStr = o.issue_date || o.created_at; 
                if (dataVendaStr) {
                    if (dataVendaStr.length === 10) dataVendaStr += 'T12:00:00'; 
                    const dVenda = new Date(dataVendaStr);
                    if (period === 'all' || (dVenda >= s && dVenda <= e)) {
                        globalSold += val;
                        if (isOwnerOrder) userSold += val;
                    }
                }

                // 2. MÉTRICA DE FATURAMENTO
                let dFaturamento = null;
                const currentStatus = getSafeStatus(o.status);

                if (currentStatus === finalStage || currentStatus.includes('finaliz') || currentStatus.includes('entregue')) {
                    const hist = o.history || [];
                    
                    if (hist.length > 0) {
                        let fatLog = [...hist].reverse().find(h => 
                            getSafeStatus(h.to) === finalStage || 
                            getSafeStatus(h.to).includes('finaliz') ||
                            String(h.action).toLowerCase().includes('fatur')
                        );

                        if (!fatLog) {
                            fatLog = hist[hist.length - 1]; 
                        }

                        if (fatLog && fatLog.date) {
                            dFaturamento = new Date(fatLog.date);
                        }
                    }
                    
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

            // ====================================================================
            // 🎨 ATUALIZAÇÃO DOS CARTÕES DO ADMIN
            // ====================================================================
            const ticketMedio = filteredData.length > 0 ? (userSold / filteredData.length) : 0;
            const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

            container.innerHTML = `
                <div class="kpi-card" style="border-left: 4px solid var(--cor-primaria)">
                    <div><span class="kpi-label">Vendas Totais</span><div class="kpi-val">${moneyFmt.format(userSold)}</div></div>
                    <div class="kpi-icon" style="background:var(--cor-primaria-soft-bg); color:var(--cor-primaria)"><i class="ph-fill ph-currency-dollar"></i></div>
                </div>
                <div class="kpi-card" style="border-left: 4px solid var(--cor-sucesso)">
                    <div><span class="kpi-label">Faturado / Concluído</span><div class="kpi-val money" style="color:var(--cor-sucesso)">${moneyFmt.format(userInvoiced)}</div></div>
                    <div class="kpi-icon" style="background:rgba(16, 185, 129, 0.1); color:var(--cor-sucesso)"><i class="ph-fill ph-receipt"></i></div>
                </div>
                <div class="kpi-card">
                    <div><span class="kpi-label">Ticket Médio</span><div class="kpi-val">${moneyFmt.format(ticketMedio)}</div></div>
                    <div class="kpi-icon" style="background:rgba(245, 158, 11, 0.1); color:var(--cor-alerta)"><i class="ph-fill ph-trend-up"></i></div>
                </div>`;

            if (filteredData.length === 0) { 
                tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--cor-texto-mutado);">Nenhum dado encontrado para este filtro.</td></tr>'; 
            } else { 
                tableBody.innerHTML = filteredData.map(o => {
                    let displayDate = '-';
                    let validDate = o.issue_date || o.created_at;
                    if (validDate) {
                        displayDate = String(validDate).split('T')[0].split('-').reverse().join('/');
                    }
                    return `<tr><td><b>#${o.id}</b><br><span style="font-size:0.8rem">${o.client || '-'}</span></td><td>${o.sales || '-'}</td><td style="color:var(--cor-sucesso); font-weight:bold;">${moneyFmt.format(o.value || 0)}</td><td>${o.payment || '-'}</td><td>${displayDate}</td><td><span class="status-badge badge-active">${o.status}</span></td></tr>`;
                }).join(''); 
            }
            if (typeof renderSalesCharts === 'function') renderSalesCharts(filteredData);
        }

        function renderSalesCharts(data) {
            const themeMode = document.body.getAttribute('data-theme') || 'light';
            const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-texto-mutado').trim() || '#6B7280';
            const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--cor-borda').trim() || '#E5E7EB';
            
            // Configurações Globais Compartilhadas
            const baseOptions = { 
                chart: { background: 'transparent', toolbar: { show: false }, fontFamily: 'Inter, sans-serif' }, 
                theme: { mode: themeMode },
                noData: { text: "Sem dados para o período", align: 'center', verticalAlign: 'middle', style: { color: mutedColor, fontSize: '14px', fontWeight: 600 } }
            };

            // Configurações de Eixos (Apenas para gráficos de Barra e Linha)
            const gridOptions = {
                xaxis: { labels: { style: { colors: mutedColor, fontWeight: 600 } }, axisBorder: { color: borderColor }, axisTicks: { color: borderColor } },
                yaxis: { labels: { style: { colors: mutedColor, fontWeight: 600 } } },
                grid: { borderColor: borderColor, strokeDashArray: 4 }
            };

            // 1. Gráfico de Pagamentos (Pizza)
            const payments = {}; 
            data.forEach(o => { const p = o.payment || 'Não Informado'; payments[p] = (payments[p] || 0) + 1; });
            const payOpt = { 
                ...baseOptions, 
                chart: { type: 'pie', height: 300, background: 'transparent', fontFamily: 'Inter, sans-serif' }, 
                series: Object.values(payments), 
                labels: Object.keys(payments), 
                colors: ['#059669', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
                stroke: { colors: [borderColor] }
            };
            if(paymentChart) paymentChart.updateOptions(payOpt); 
            else { paymentChart = new ApexCharts(document.querySelector("#chart-payment"), payOpt); paymentChart.render(); }

            // 2. Gráfico Top Clientes (Barra Horizontal com Dinheiro)
            const clients = {}; 
            data.forEach(o => { const c = o.client || 'N/D'; clients[c] = (clients[c] || 0) + parseFloat(o.value || 0); });
            const sortedClients = Object.entries(clients).sort((a,b) => b[1] - a[1]).slice(0, 5);
            const clientOpt = { 
                ...baseOptions, 
                ...gridOptions,
                chart: { type: 'bar', height: 300, background: 'transparent', toolbar: { show: false }, fontFamily: 'Inter, sans-serif' }, 
                plotOptions: { bar: { horizontal: true, borderRadius: 4 } }, 
                series: [{ name: 'Valor Comprado', data: sortedClients.map(x => x[1]) }], 
                xaxis: { 
                    ...gridOptions.xaxis,
                    categories: sortedClients.map(x => x[0]),
                    labels: { 
                        style: { colors: mutedColor, fontWeight: 600 },
                        formatter: (val) => Number(val).toLocaleString('pt-BR', {style:'currency', currency:'BRL', maximumFractionDigits:0}) 
                    }
                }, 
                dataLabels: { enabled: false },
                colors: ['#F59E0B'] 
            };
            if(clientsChart) clientsChart.updateOptions(clientOpt); 
            else { clientsChart = new ApexCharts(document.querySelector("#chart-clients"), clientOpt); clientsChart.render(); }

            // 3. Gráfico Funil de Estados (Barra Vertical)
            const statusCounts = {}; 
            if(configData.workflow && configData.workflow.length > 0) {
                configData.workflow.forEach(w => statusCounts[w.name] = 0); 
            }
            data.forEach(o => { 
                const s = o.status;
                if(statusCounts[s] !== undefined) statusCounts[s]++; 
                else statusCounts[s] = (statusCounts[s] || 0) + 1;
            });
            const statusOpt = { 
                ...baseOptions, 
                ...gridOptions,
                chart: { type: 'bar', height: 300, background: 'transparent', toolbar: { show: false }, fontFamily: 'Inter, sans-serif' }, 
                plotOptions: { bar: { borderRadius: 4, columnWidth: '50%' } }, 
                series: [{ name: 'Pedidos na Etapa', data: Object.values(statusCounts) }], 
                xaxis: { ...gridOptions.xaxis, categories: Object.keys(statusCounts) }, 
                dataLabels: { enabled: false },
                colors: ['#2563EB'] 
            };
            if(statusChart) statusChart.updateOptions(statusOpt); 
            else { statusChart = new ApexCharts(document.querySelector("#chart-status"), statusOpt); statusChart.render(); }

            // 4. Gráfico Evolução Diária (Área)
            const daily = {}; 
            data.forEach(o => { 
                let d = o.issue_date || o.created_at;
                if(d) { 
                    try{ 
                        const k = String(d).split('T')[0]; 
                        daily[k] = (daily[k] || 0) + 1; 
                    }catch(e){} 
                } 
            });
            const sortedDates = Object.keys(daily).sort();
            const dailyOpt = { 
                ...baseOptions, 
                ...gridOptions,
                chart: { type: 'area', height: 300, background: 'transparent', toolbar: { show: false }, fontFamily: 'Inter, sans-serif' }, 
                series: [{ name: 'Pedidos Criados', data: sortedDates.map(k => daily[k]) }], 
                xaxis: { ...gridOptions.xaxis, categories: sortedDates.map(k => k.split('-').reverse().slice(0,2).join('/')) }, 
                stroke: { curve: 'smooth', width: 3 }, 
                dataLabels: { enabled: false },
                colors: ['#10B981'], 
                fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] } } 
            };
            if(dailyChart) dailyChart.updateOptions(dailyOpt); 
            else { dailyChart = new ApexCharts(document.querySelector("#chart-daily"), dailyOpt); dailyChart.render(); }
        }

        async function saveNewDate() {
            const id = document.getElementById('edit-date-id').value;
            const newDate = document.getElementById('new-delivery-date').value;
            if(!newDate) return Swal.fire('Aviso', 'Selecione uma data válida.', 'warning');
            
            const o = ordersData.find(x => String(x.id) === String(id));
            if(!o) return;
            
            const dateStrBR = String(newDate).split('-').reverse().join('/');
            
            const oldHistory = Array.isArray(o.history) ? o.history : [];
            const newEntry = SinalizaCore.buildHistoryEntry('Ajuste de Prazo', o.status, 'Admin', '', `Data alterada para ${dateStrBR}`);
            const newHistory = [...oldHistory, newEntry];
            
            try { 
                await apiFetch(`/pedidos/${id}`, 'PUT', { 
                    data_entrega: newDate, 
                    history: newHistory 
                });
                
                document.getElementById('editDateModal').style.display = 'none'; 
                Swal.fire({toast:true, position:'top-end', title:'Data atualizada!', icon:'success', showConfirmButton:false, timer:3000});
                loadData(); 
            } catch(e) { 
                Swal.fire('Erro', 'Motivo: ' + (e.message || e), 'error'); 
            }
        }

        function openEditDateModal(id, currentDate) {
            document.getElementById('edit-date-id').value = id;
            document.getElementById('new-delivery-date').value = currentDate !== '9999-12-31' ? currentDate : '';
            document.getElementById('editDateModal').style.display = 'flex';
        }

        function openEditOrderModal(id) {
            const o = ordersData.find(x => String(x.id) === String(id));
            if(!o) return;
            document.getElementById('eo-id').value = id;
            document.getElementById('eo-client').value = o.client || '';
            document.getElementById('eo-value').value = o.value || '';
            document.getElementById('eo-sales').value = o.sales || '';
            document.getElementById('eo-payment').value = o.payment || '';
            document.getElementById('eo-reason').value = '';
            document.getElementById('editOrderModal').style.display = 'flex';
        }

        async function saveEditedOrder() {
            const id = document.getElementById('eo-id').value;
            const reason = document.getElementById('eo-reason').value.trim();
            if (!reason) return Swal.fire('Obrigatório', 'Insira o motivo para auditoria.', 'warning');

            const o = ordersData.find(x => String(x.id) === String(id));
            
            const newClient = document.getElementById('eo-client').value;
            const newValue = document.getElementById('eo-value').value;
            const newSales = document.getElementById('eo-sales').value;
            const newPayment = document.getElementById('eo-payment').value;

            let auditLogs = [];
            const checkDiff = (field, oldVal, newVal) => {
                if (String(oldVal || '') !== String(newVal || '')) {
                    auditLogs.push({
                        pedido_id: id, admin_user: 'Admin', campo_alterado: field, valor_antigo: oldVal, valor_novo: newVal, motivo: reason
                    });
                }
            };

            checkDiff('client', o.client, newClient);
            checkDiff('value', o.value, newValue);
            checkDiff('sales', o.sales, newSales);
            checkDiff('payment', o.payment, newPayment);

            if (auditLogs.length === 0) return Swal.fire('Sem Alterações', 'Nenhum dado foi modificado.', 'info');

            const btn = document.querySelector('#editOrderModal .btn-warning');
            const txt = btn.innerHTML;
            btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> A guardar...';
            btn.disabled = true;

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', { 
                    client: newClient, 
                    value: newValue, 
                    sales: newSales, 
                    payment: newPayment,
                    auditLogs: auditLogs
                });
                
                document.getElementById('editOrderModal').style.display = 'none';
                Swal.fire('Guardado', 'Dados registados.', 'success');
                loadData();
            } catch(e) {
                Swal.fire('Erro', 'Falha: ' + (e.message || e), 'error');
            } finally {
                btn.innerHTML = txt; btn.disabled = false;
            }
        }

        function deleteOrderPerm(id) {
            Swal.fire({
                title: 'Eliminação Definitiva',
                html: `Tem a certeza de que deseja eliminar <b>#${id}</b>?`,
                icon: 'error',
                input: 'text',
                inputPlaceholder: 'Escreva ELIMINAR',
                showCancelButton: true,
                confirmButtonColor: 'var(--cor-erro)',
                confirmButtonText: 'Eliminar',
                cancelButtonText: 'Cancelar',
                preConfirm: (inputValue) => {
                    if (inputValue !== 'ELIMINAR') Swal.showValidationMessage('Escreva ELIMINAR');
                }
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        await apiFetch(`/pedidos/${id}`, 'DELETE');
                        Swal.fire('Eliminado!', 'Pedido apagado.', 'success');
                        loadData();
                    } catch(e) {
                        Swal.fire('Erro', 'Não foi possível eliminar: ' + (e.message || e), 'error');
                    }
                }
            });
        }

        function openBypassModal(id) {
            document.getElementById('bypass-id').value = id;
            document.getElementById('bypass-reason').value = '';
            const select = document.getElementById('bypass-target');
            select.innerHTML = '<option value="">Selecione a etapa de destino...</option>';
            configData.workflow.forEach(w => { select.innerHTML += `<option value="${w.name}">${w.name}</option>`; });
            document.getElementById('bypassModal').style.display = 'flex';
        }

        async function confirmBypass() {
            const id = document.getElementById('bypass-id').value;
            const st = document.getElementById('bypass-target').value;
            const reason = document.getElementById('bypass-reason').value.trim();
            
            if(!st || !reason) return Swal.fire('Aviso', 'Destino e motivo obrigatórios.', 'warning');

            const o = ordersData.find(x => String(x.id) === String(id));
            if(o) {
                const oldHistory = Array.isArray(o.history) ? o.history : [];
                const newEntry = SinalizaCore.buildHistoryEntry('Bypass/Forçar', st, 'Admin', '', `Quebra de Fluxo: ${reason}`);
                const newHistory = [...oldHistory, newEntry];
                try { 
                    const ts = SinalizaCore.gerarTimestamps(o.status, st);
                    await apiFetch(`/pedidos/${id}`, 'PUT', { status: st, history: newHistory, ...ts }); 
                    
                    document.getElementById('bypassModal').style.display = 'none';
                    Swal.fire('Forçado!', `Movido para ${st}.`, 'success');
                    loadData(); 
                } catch(e) { Swal.fire('Erro', 'Falha: ' + (e.message || e), 'error'); }
            }
        }

        function openModal(id, next, type) { 
            document.getElementById('modal-id').value = id; 
            document.getElementById('modal-new-status').value = next; 
            document.getElementById('modal-move-type').value = type;
            document.getElementById('modal-obs').value = ''; 
            
            const o = ordersData.find(x => String(x.id) === String(id));
            const currentStep = configData.workflow.find(w => w.name === o.status);
            const role = currentStep ? currentStep.role : 'admin';

            const reasonSelect = document.getElementById('modal-reason-select');
            reasonSelect.innerHTML = '<option value="">Selecione o motivo...</option>';
            
            let availableReasons = [];
            if (configData.movementReasons && configData.movementReasons[role]) {
                const direction = type === 'next' ? 'forward' : 'backward';
                if (role === 'faturamento' && direction === 'backward') {
                     availableReasons = ['Retorno (Admin)'];
                } else {
                     availableReasons = configData.movementReasons[role][direction] || [];
                }
            }
            if (availableReasons.length === 0) availableReasons = ['Normal (Admin Move)'];
            availableReasons.forEach(r => { reasonSelect.innerHTML += `<option value="${r}">${r}</option>`; });

            document.getElementById('actionModal').style.display = 'flex'; 
            document.getElementById('modal-title').innerHTML = type === 'next' ? 'Avançar Etapa' : 'Devolver Etapa'; 
            document.getElementById('modal-desc').innerHTML = `Movimentar pedido <b>#${id}</b> para <b>${next}</b>?`; 
        }

        async function confirmAction() {
            const id = document.getElementById('modal-id').value; 
            const st = document.getElementById('modal-new-status').value; 
            const reason = document.getElementById('modal-reason-select').value;
            const obsText = document.getElementById('modal-obs').value;
            
            if (!reason) return Swal.fire('Atenção', 'Selecione um motivo.', 'warning');

            const o = ordersData.find(x => String(x.id) === String(id));
            if(o) {
                const oldHistory = Array.isArray(o.history) ? o.history : [];
                const newEntry = SinalizaCore.buildHistoryEntry('Admin Move', st, 'Admin', reason, obsText);
                const newHistory = [...oldHistory, newEntry];
                try { 
                    const ts = SinalizaCore.gerarTimestamps(o.status, st);
                    await apiFetch(`/pedidos/${id}`, 'PUT', { status: st, history: newHistory, ...ts }); 
                    
                    closeModal(); 
                    Swal.fire({toast:true, position:'top-end', title:'Movimentado!', icon:'success', showConfirmButton:false, timer:3000});
                    loadData(); 
                } catch(e) { Swal.fire('Erro', 'Erro: ' + (e.message || e), 'error'); }
            }
        }
        
        function closeModal() { document.getElementById('actionModal').style.display='none'; }

        async function applyBulkAction() {
            const targetStatus = document.getElementById('bulk-stage').value;
            if(!targetStatus) return Swal.fire('Aviso', 'Selecione a etapa de destino.', 'warning');
            
            const checks = document.querySelectorAll('.bulk-check:checked');
            if(checks.length === 0) return;
            
            const btn = document.getElementById('btn-bulk-run'); btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i>`; btn.disabled = true;
            const ids = Array.from(checks).map(c => c.value);
            
            const promises = ids.map(async (id) => {
                const order = ordersData.find(o => String(o.id) === String(id)); if(!order) return;
                
                const oldHistory = Array.isArray(order.history) ? order.history : [];
                const newEntry = SinalizaCore.buildHistoryEntry('Bulk Move', targetStatus, 'Admin', '', 'Movimentação em Massa');
                const newHistory = [...oldHistory, newEntry];
                
                const ts = SinalizaCore.gerarTimestamps(order.status, targetStatus);
                await apiFetch(`/pedidos/${id}`, 'PUT', { status: targetStatus, history: newHistory, ...ts });
            });

            try { 
                await Promise.all(promises); 
                Swal.fire('Sucesso!', `${ids.length} pedidos movidos!`, 'success');
                clearBulkSelection(); 
                loadData(); 
            } 
            catch(e) { Swal.fire('Erro', 'Erro ao processar lote: ' + (e.message || e), 'error'); } 
            finally { btn.innerHTML = `Mover Itens <i class="ph-bold ph-arrow-right"></i>`; btn.disabled = false; }
        }

        function renderOrders() {
            const container = document.getElementById('orders-container'); 
            
            if (!configData.workflow || configData.workflow.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:60px; color:var(--cor-texto-mutado);">Aguardando configurações de Workflow...</div>';
                return;
            }

            const search = String(document.getElementById('search-input').value).toLowerCase().trim();
            const filter = String(document.getElementById('filter-status').value).trim();
            const finalStage = getSafeStatus(configData.workflow[configData.workflow.length-1].name);
            
            const filtered = ordersData.filter(o => {
                let oStatusSafe = getSafeStatus(o.status);
                if (o.history && o.history.length > 0) {
                    const lastLog = o.history[o.history.length - 1];
                    if (lastLog.to) oStatusSafe = getSafeStatus(lastLog.to);
                }
                if (oStatusSafe === 'finalizado' || oStatusSafe === 'concluido' || oStatusSafe === 'entregue') {
                    oStatusSafe = finalStage;
                }

                if (oStatusSafe === finalStage && getSafeStatus(filter) !== finalStage) return false;
                
                const clientText = o.client ? String(o.client).toLowerCase() : ''; 
                const idText = o.id ? String(o.id) : ''; 
                const matchesSearch = search === '' || clientText.includes(search) || idText.includes(search);
                
                let slaInfo = { status: 'normal' };
                try { slaInfo = SinalizaCore.calculateSLA(o, (o.prodData?.extensions || [])) || slaInfo; } catch(e){}
                
                let matchesFilter = true; 
                if(filter === 'late') { 
                    matchesFilter = (slaInfo.status === 'late'); 
                } else if(filter !== 'all') { 
                    matchesFilter = (oStatusSafe === getSafeStatus(filter)); 
                }
                return matchesSearch && matchesFilter;
            });

            filtered.sort((a,b) => {
                let sA = { dateStr: '9999-12-31' }, sB = { dateStr: '9999-12-31' };
                try { sA = SinalizaCore.calculateSLA(a) || sA; } catch(e){}
                try { sB = SinalizaCore.calculateSLA(b) || sB; } catch(e){}
                return new Date(sA.dateStr) - new Date(sB.dateStr);
            });

            if(filtered.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--cor-texto-mutado);">Nenhum pedido encontrado.</div>';
            } else {
                container.innerHTML = filtered.map(o => {
                    try { return createCardHTML(o, finalStage); } 
                    catch(e) { console.error("Erro na Row", e); return ''; }
                }).join(''); 
            }
            try { clearBulkSelection(); }catch(e){}
        }

        function createCardHTML(o, finalStage) {
            const stepsSafe = configData.workflow.map(x => getSafeStatus(x.name)); 
            
            let oStatusSafe = getSafeStatus(o.status);
            if (o.history && o.history.length > 0) {
                const lastLog = o.history[o.history.length - 1];
                if (lastLog.to) oStatusSafe = getSafeStatus(lastLog.to);
            }
            if (oStatusSafe === 'finalizado' || oStatusSafe === 'concluido' || oStatusSafe === 'entregue') {
                oStatusSafe = finalStage;
            }

            let idx = stepsSafe.indexOf(oStatusSafe); 
            if(idx === -1) {
                const revHistory = [...(o.history || [])].reverse();
                for(let h of revHistory) {
                    const hTo = getSafeStatus(h.to);
                    const hIdx = stepsSafe.indexOf(hTo);
                    if(hIdx !== -1) { idx = hIdx; break; }
                }
                if(idx === -1) idx = 0;
            } 
            
            let slaInfo = { status: 'normal', displayDate: 'N/D', dateStr: '9999-12-31' };
            try { slaInfo = SinalizaCore.calculateSLA(o, (o.prodData?.extensions || [])) || slaInfo; } catch(e){}
            
            const isLate = slaInfo.status === 'late';
            const isDone = (oStatusSafe === finalStage) || (idx === stepsSafe.length - 1);
            
            let moneyVal = 'R$ -';
            try { moneyVal = o.value ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(String(o.value).replace(',','.')) || 0) : 'R$ -'; }catch(e){}
            
            const originalSteps = configData.workflow.map(x => x.name);
            let displaySteps = originalSteps;
            
            if(originalSteps.length > 5) {
                if(idx < 3) { displaySteps = originalSteps.slice(0, 4); } 
                else if (idx >= originalSteps.length - 2) { displaySteps = originalSteps.slice(originalSteps.length - 4); } 
                else { displaySteps = originalSteps.slice(idx - 1, idx + 3); }
            }

            const stepperHTML = displaySteps.map((stepName, i) => { 
                const realIdx = stepsSafe.indexOf(getSafeStatus(stepName));
                let cls = '', ico = ''; 
                let stepDate = '';

                if (realIdx <= idx) {
                    const historyMoves = Array.isArray(o.history) ? o.history : [];
                    const move = [...historyMoves].reverse().find(h => getSafeStatus(h.to) === getSafeStatus(stepName));
                    
                    if (move && move.date) {
                        try {
                            const d = new Date(move.date);
                            if(!isNaN(d)) {
                                const day = String(d.getDate()).padStart(2, '0');
                                const month = String(d.getMonth() + 1).padStart(2, '0');
                                stepDate = day + '/' + month;
                            }
                        } catch(e){}
                    } else if (realIdx === 0 && o.created_at) { 
                        try {
                            const d = new Date(o.created_at);
                            if(!isNaN(d)) {
                                const day = String(d.getDate()).padStart(2, '0');
                                const month = String(d.getMonth() + 1).padStart(2, '0');
                                stepDate = day + '/' + month;
                            }
                        } catch(e){}
                    }
                }

                if (realIdx < idx) { 
                    cls = 'done'; ico = '<i class="ph-bold ph-check"></i>'; 
                } else if (realIdx === idx) { 
                    cls = isLate ? 'active late' : 'active';
                    ico = '<i class="ph-bold ph-spinner-gap stepper-spinner"></i>';
                } 
                
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
            let tagPrioridade = '';
            if (tipoPedido === 'homologado') {
                tagPrioridade = `<div class="tag-homologado"><i class="ph-fill ph-star"></i> HOMOL</div>`;
            } else if (tipoPedido === 'projeto') {
                tagPrioridade = `<div class="tag-projeto"><i class="ph-fill ph-blueprint"></i> PROJ</div>`;
            }

            let prevStep = null, nextStep = null;
            try { 
                prevStep = SinalizaCore.getPrevStep(o.status, configData.workflow); 
                nextStep = SinalizaCore.getNextStep(o.status, configData.workflow); 
            } catch(e){}
            
            let rowClass = "list-row";
            if(isLate) rowClass += " late";

            let statusBadge = isLate ? '<span class="status-badge badge-late">ATRASADO</span>' 
                            : (isDone ? '<span class="status-badge badge-done">FINALIZADO</span>' 
                            : '<span class="status-badge badge-active">NO FLUXO</span>');

            let safeClient = o.client ? String(o.client).replace(/"/g, '&quot;') : '';

            return `
            <div class="${rowClass}">
                <div class="list-col-info">
                    <div class="info-top">
                        <input type="checkbox" class="bulk-check" value="${o.id}" onchange="toggleBulkSelection()">
                        <span class="id-badge">#${o.id}</span>
                        ${tagPrioridade}
                    </div>
                    <div class="client-name" title="${safeClient}">${safeClient || 'N/D'}</div>
                    <div class="info-bottom">
                        <span class="money-val">${moneyVal}</span>
                        <span class="date-val" onclick="openEditDateModal('${o.id}', '${slaInfo.dateStr}')" style="cursor:pointer;">
                            <i class="ph-bold ph-calendar-blank"></i> Praz: <strong>${slaInfo.displayDate}</strong>
                        </span>
                        <span style="display:flex; align-items:center; gap:5px;"><i class="ph-bold ph-user"></i> ${o.sales || '-'}</span>
                    </div>
                </div>

                <div class="list-col-stepper" onclick="openHistoryModal('${o.id}')">
                    <div class="stepper-wrapper">
                        ${stepperHTML}
                    </div>
                </div>

                <div class="list-col-actions">
                    ${statusBadge}
                    <div class="action-buttons">
                        <button class="btn-act" onclick="abrirPreview('${o.id}')" title="Ver Arquivos"><i class="ph-bold ph-folder-open"></i></button>
                        <button class="btn-act" onclick="openBypassModal('${o.id}')" title="Forçar Etapa"><i class="ph-bold ph-magic-wand"></i></button>
                        <button class="btn-act" onclick="openEditOrderModal('${o.id}')" title="Editar"><i class="ph-bold ph-pencil-simple"></i></button>
                        <button class="btn-act" onclick="deleteOrderPerm('${o.id}')" title="Excluir"><i class="ph-bold ph-trash"></i></button>
                        ${prevStep && configData.workflow[idx] && configData.workflow[idx].canReturn ? `<button class="btn-act" onclick="openModal('${o.id}', '${prevStep}', 'back')" title="Devolver Etapa"><i class="ph-bold ph-arrow-u-up-left"></i></button>` : ''}
                        ${nextStep ? `<button class="btn-nav" onclick="openModal('${o.id}', '${nextStep}', 'next')">Avançar <i class="ph-bold ph-arrow-right"></i></button>` : ''}
                    </div>
                </div>
            </div>`;
        }

        function openHistoryModal(id) {
            const o = ordersData.find(x => String(x.id) === String(id));
            if(!o) return;

            document.getElementById('hist-order-id').innerText = '#' + id;
            const container = document.getElementById('history-container');
            container.innerHTML = '';

            if (!Array.isArray(o.history) || o.history.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding: 40px; color:var(--cor-texto-mutado);">Nenhum histórico registado.</div>';
            } else {
                const histRev = [...o.history].reverse();
                
                histRev.forEach((h, index) => {
                    const dateObj = new Date(h.date);
                    const dateStr = dateObj.toLocaleDateString('pt-BR') + ' às ' + dateObj.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
                    
                    let actionBadge = '';
                    if(h.action.includes('Admin') || h.action.includes('Bypass') || h.action.includes('Massa')) {
                        actionBadge = `<span class="badge-warning" style="padding:2px 8px; border-radius:12px; font-size:0.7rem; font-weight:700;">${h.action.toUpperCase()}</span>`;
                    } else if(h.action.includes('Ajuste') || h.action.includes('Prazo')) {
                        actionBadge = `<span class="badge-active" style="padding:2px 8px; border-radius:12px; font-size:0.7rem; font-weight:700;">${h.action.toUpperCase()}</span>`;
                    } else {
                        actionBadge = `<span class="badge-done" style="padding:2px 8px; border-radius:12px; font-size:0.7rem; font-weight:700;">MOVIMENTAÇÃO</span>`;
                    }

                    let obsHtml = h.obs ? `<div style="font-size: 0.9rem; margin-top: 10px; background: var(--cor-card-bg); padding: 12px; border-radius: 8px; border-left: 3px solid var(--cor-primaria);">${h.obs}</div>` : '';
                    let isCurrent = index === 0 ? `<span style="color:var(--cor-primaria); font-size:0.7rem; font-weight:700; border: 1px solid; padding: 2px 6px; border-radius: 4px; margin-left:auto;">ESTADO ATUAL</span>` : '';

                    container.innerHTML += `
                        <div style="padding: 15px 0; border-bottom: 1px dashed var(--cor-borda);">
                            <div style="font-size: 0.75rem; color: var(--cor-texto-mutado); margin-bottom: 6px; display:flex; align-items:center; gap:6px; font-weight: 700;"><i class="ph-bold ph-calendar-blank"></i> ${dateStr} ${isCurrent}</div>
                            <div style="font-weight: 700; font-size: 0.95rem; display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                                <i class="ph-bold ph-user-circle" style="font-size:1.2rem; color:var(--cor-texto-mutado)"></i> ${h.user || 'Sistema'}
                                <i class="ph-bold ph-arrow-right" style="color:var(--cor-texto-mutado)"></i> 
                                <span>${h.to}</span>
                                ${actionBadge}
                            </div>
                            ${obsHtml}
                        </div>
                    `;
                });
            }
            document.getElementById('historyModal').style.display = 'flex';
        }

        function closeHistoryModal() { document.getElementById('historyModal').style.display = 'none'; }

        function setupAdminOnlyControls() {
            const allowed = isCurrentAdmin();
            document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
                el.style.display = allowed ? '' : 'none';
            });
        }

        function normalizeAdminText(value) {
            return String(value ?? '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim();
        }

        function getAdminOrderRawValue(order, keys) {
            const raw = order && order._raw ? order._raw : {};
            for (const key of keys) {
                if (raw[key] !== undefined && raw[key] !== null) return raw[key];
                const lower = key.toLowerCase();
                if (raw[lower] !== undefined && raw[lower] !== null) return raw[lower];
            }
            return undefined;
        }

        function getAdminOrderCurrentStatus(order) {
            const history = Array.isArray(order?.history) ? order.history : [];
            const lastWithTarget = [...history].reverse().find(h => h && h.to);
            return lastWithTarget ? String(lastWithTarget.to || '') : String(order?.status || '');
        }

        function getAdminOrderSector(order) {
            if (isOrderFinalized(order)) return 'finalizado';
            const status = normalizeAdminText(getAdminOrderCurrentStatus(order));
            const step = (configData.workflow || []).find(w => normalizeAdminText(w.name) === status);
            if (step && step.role) return normalizeAdminText(step.role);
            if (status.includes('comercial')) return 'comercial';
            if (status.includes('layout')) return 'layout';
            if (status.includes('pcp')) return 'pcp';
            if (status.includes('produc')) return 'producao';
            if (status.includes('fatur')) return 'faturamento';
            return 'fora_fluxo';
        }

        function isOrderFinalized(order) {
            const finalStage = configData.workflow && configData.workflow.length > 0
                ? normalizeAdminText(configData.workflow[configData.workflow.length - 1].name)
                : 'finalizado';
            const status = normalizeAdminText(order?.status);
            const currentStatus = normalizeAdminText(getAdminOrderCurrentStatus(order));
            const rawFinalizado = getAdminOrderRawValue(order, ['FINALIZADO', 'finalizado']);
            const rawFinalizedAt = getAdminOrderRawValue(order, ['FINALIZADO_EM', 'finalizado_em', 'DATA_FINALIZACAO', 'data_finalizacao']);
            const rawFinishStatus = normalizeAdminText(getAdminOrderRawValue(order, ['STATUS_FINALIZACAO', 'status_finalizacao', 'STATUS_FLUXO', 'status_fluxo']));
            const history = Array.isArray(order?.history) ? order.history : [];
            const lastAction = normalizeAdminText(history.length ? history[history.length - 1].action : '');

            return rawFinalizado === true
                || rawFinalizado === 1
                || rawFinalizado === '1'
                || rawFinalizado === 'S'
                || normalizeAdminText(rawFinalizado) === 'true'
                || Boolean(rawFinalizedAt)
                || status === finalStage
                || currentStatus === finalStage
                || ['finalizado', 'concluido', 'entregue'].some(key => status.includes(key) || currentStatus.includes(key) || rawFinishStatus.includes(key))
                || lastAction.includes('nota emitida')
                || lastAction.includes('finalizad');
        }

        function canAdminReopenOrder(order) {
            if (!isCurrentAdmin() || !order) return false;
            const status = normalizeAdminText(order.status);
            const currentStatus = normalizeAdminText(getAdminOrderCurrentStatus(order));
            const finishStatus = normalizeAdminText(getAdminOrderRawValue(order, ['STATUS_FINALIZACAO', 'status_finalizacao', 'STATUS_FLUXO', 'status_fluxo']));
            return isOrderFinalized(order)
                || status.includes('finaliz')
                || currentStatus.includes('finaliz')
                || finishStatus.includes('finaliz')
                || finishStatus.includes('conclu');
        }

        function getAdminOrderSearchText(order) {
            const history = Array.isArray(order.history) ? order.history : [];
            const lastMove = history.length ? history[history.length - 1] : {};
            return normalizeAdminText([
                order.id,
                order.client,
                order.status,
                getAdminOrderCurrentStatus(order),
                getAdminOrderSector(order),
                order.delivery,
                order.issue_date,
                order.created_at,
                order.sales,
                lastMove.user,
                lastMove.action,
                lastMove.to
            ].filter(Boolean).join(' '));
        }

        function getAdminOrdersBaseFiltered() {
            const search = normalizeAdminText(document.getElementById('admin-orders-search')?.value || '');
            const statusFilter = document.getElementById('admin-orders-status-filter')?.value || '';
            const sectorFilter = document.getElementById('admin-orders-sector-filter')?.value || '';
            const workflowStatuses = (configData.workflow || []).map(w => normalizeAdminText(w.name));

            return ordersData.filter(order => {
                const finalized = isOrderFinalized(order);
                const sector = getAdminOrderSector(order);
                const currentStatus = normalizeAdminText(getAdminOrderCurrentStatus(order));
                const inWorkflow = workflowStatuses.includes(currentStatus) || finalized;
                let slaInfo = { status: 'normal' };
                try { slaInfo = SinalizaCore.calculateSLA(order, (order.prodData?.extensions || [])) || slaInfo; } catch(e) {}

                if (search && !getAdminOrderSearchText(order).includes(search)) return false;
                if (sectorFilter && sector !== sectorFilter) return false;
                if (statusFilter === 'ativos' && finalized) return false;
                if (statusFilter === 'finalizados' && !finalized) return false;
                if (statusFilter === 'atrasados' && slaInfo.status !== 'late') return false;
                if (statusFilter === 'em_fluxo' && (!inWorkflow || finalized)) return false;
                if (statusFilter === 'fora_fluxo' && inWorkflow) return false;
                return true;
            });
        }

        function renderAdminOrdersBase() {
            if (!isCurrentAdmin()) {
                const container = document.getElementById('admin-orders-base-container');
                if (container) container.innerHTML = '<div class="admin-orders-empty">Acesso restrito ao Admin.</div>';
                return;
            }

            const container = document.getElementById('admin-orders-base-container');
            if (!container) return;
            const filtered = getAdminOrdersBaseFiltered();

            if (filtered.length === 0) {
                container.innerHTML = '<div class="admin-orders-empty">Nenhum pedido encontrado para os filtros selecionados.</div>';
                return;
            }

            container.innerHTML = filtered.map(order => {
                const orderArg = escapeAdminHtml(JSON.stringify(String(order.id)));
                const finalized = isOrderFinalized(order);
                const canReopen = canAdminReopenOrder(order);
                const sector = getAdminOrderSector(order);
                const history = Array.isArray(order.history) ? order.history : [];
                const lastMove = history.length ? history[history.length - 1] : null;
                const currentStatus = getAdminOrderCurrentStatus(order) || 'N/D';
                let slaInfo = { displayDate: 'N/D', status: 'normal' };
                try { slaInfo = SinalizaCore.calculateSLA(order, (order.prodData?.extensions || [])) || slaInfo; } catch(e) {}

                const sectorLabel = sector === 'fora_fluxo' ? 'Fora do fluxo' : sector.charAt(0).toUpperCase() + sector.slice(1);
                const statusClass = finalized ? 'is-done' : (slaInfo.status === 'late' ? 'is-late' : 'is-active');
                const lastMoveText = lastMove
                    ? `${escapeAdminHtml(lastMove.action || 'Movimentação')} - ${escapeAdminHtml(lastMove.user || 'Sistema')}`
                    : 'Sem movimentação registrada';

                return `
                    <article class="admin-order-base-card ${statusClass}">
                        <div class="admin-order-base-main">
                            <div class="admin-order-base-titleline">
                                <span class="id-badge">#${escapeAdminHtml(order.id)}</span>
                                <span class="admin-order-status-pill">${escapeAdminHtml(currentStatus)}</span>
                                ${finalized ? '<span class="admin-order-final-pill"><i class="ph-fill ph-check-circle"></i> Finalizado</span>' : ''}
                            </div>
                            <h3 title="${escapeAdminHtml(order.client || '')}">${escapeAdminHtml(order.client || 'Cliente não informado')}</h3>
                            <div class="admin-order-base-meta">
                                <span><i class="ph-bold ph-map-pin-line"></i> ${escapeAdminHtml(sectorLabel)}</span>
                                <span><i class="ph-bold ph-calendar-blank"></i> ${escapeAdminHtml(slaInfo.displayDate || 'N/D')}</span>
                                <span><i class="ph-bold ph-user"></i> ${escapeAdminHtml(order.sales || '-')}</span>
                                <span><i class="ph-bold ph-clock-counter-clockwise"></i> ${lastMoveText}</span>
                            </div>
                        </div>
                        <div class="admin-order-base-actions">
                            <button class="btn btn-secondary" type="button" onclick="openAdminOrderDetails(${orderArg})"><i class="ph-bold ph-eye"></i> Ver detalhes</button>
                            <button class="btn btn-secondary" type="button" onclick="openHistoryModal(${orderArg})"><i class="ph-bold ph-clock-counter-clockwise"></i> Histórico</button>
                            <button class="btn btn-secondary" type="button" onclick="abrirPreview(${orderArg})"><i class="ph-bold ph-folder-open"></i> Arquivos</button>
                            ${canReopen ? `<button class="btn btn-warning admin-reopen-btn" type="button" onclick="openAdminReopenOrderModal(${orderArg})" title="Retornar pedido para etapa anterior"><i class="ph-bold ph-arrow-counter-clockwise"></i> Reabrir</button>` : ''}
                        </div>
                    </article>`;
            }).join('');
        }

        function filterAdminOrdersBase() {
            renderAdminOrdersBase();
        }

        async function refreshAdminOrdersBase() {
            const btn = document.getElementById('btn-admin-orders-refresh');
            const original = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Atualizando';
            }
            await loadData();
            renderAdminOrdersBase();
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = original;
            }
        }

        function openAdminOrderDetails(orderId) {
            if (!isCurrentAdmin()) return Swal.fire('Acesso restrito', 'Apenas Admin pode abrir a Base de Pedidos.', 'warning');
            const order = ordersData.find(x => String(x.id) === String(orderId));
            if (!order) return Swal.fire('Pedido não encontrado', 'Atualize a base e tente novamente.', 'warning');
            const history = Array.isArray(order.history) ? order.history : [];
            const lastMove = history.length ? history[history.length - 1] : null;
            let slaInfo = { displayDate: 'N/D', status: 'normal' };
            try { slaInfo = SinalizaCore.calculateSLA(order, (order.prodData?.extensions || [])) || slaInfo; } catch(e) {}

            Swal.fire({
                title: `Pedido #${escapeAdminHtml(order.id)}`,
                width: 760,
                html: `
                    <div class="admin-order-details-grid">
                        <div><span>Cliente</span><strong>${escapeAdminHtml(order.client || '-')}</strong></div>
                        <div><span>Status atual</span><strong>${escapeAdminHtml(getAdminOrderCurrentStatus(order) || '-')}</strong></div>
                        <div><span>Setor</span><strong>${escapeAdminHtml(getAdminOrderSector(order))}</strong></div>
                        <div><span>Prazo</span><strong>${escapeAdminHtml(slaInfo.displayDate || '-')}</strong></div>
                        <div><span>Vendedor/responsável</span><strong>${escapeAdminHtml(order.sales || '-')}</strong></div>
                        <div><span>Finalizado</span><strong>${isOrderFinalized(order) ? 'Sim' : 'Não'}</strong></div>
                        <div><span>Valor</span><strong>${escapeAdminHtml(order.value || '-')}</strong></div>
                        <div><span>Pagamento</span><strong>${escapeAdminHtml(order.payment || '-')}</strong></div>
                    </div>
                    <div class="admin-order-details-last">
                        <span>Última movimentação</span>
                        <strong>${lastMove ? `${escapeAdminHtml(lastMove.action || '-')} - ${escapeAdminHtml(lastMove.user || 'Sistema')}` : 'Sem histórico'}</strong>
                    </div>`,
                confirmButtonText: 'Fechar'
            });
        }

        function openAdminReopenOrderModal(orderId) {
            if (!isCurrentAdmin()) return Swal.fire('Acesso restrito', 'Apenas Admin pode reabrir pedidos.', 'warning');
            const order = ordersData.find(x => String(x.id) === String(orderId));
            if (!canAdminReopenOrder(order)) return Swal.fire('Ação indisponível', 'Este pedido não está finalizado ou em finalização.', 'info');

            selectedAdminReopenOrderId = String(orderId);
            document.getElementById('admin-reopen-order-id').value = selectedAdminReopenOrderId;
            document.getElementById('admin-reopen-order-summary').innerHTML = `Pedido <strong>#${escapeAdminHtml(order.id)}</strong> - ${escapeAdminHtml(order.client || 'Cliente não informado')}<br>Status atual: <strong>${escapeAdminHtml(getAdminOrderCurrentStatus(order) || order.status || '-')}</strong>`;
            document.getElementById('admin-reopen-reason').value = '';
            document.getElementById('admin-reopen-observation').value = '';

            const targetSelect = document.getElementById('admin-reopen-target-status');
            targetSelect.innerHTML = '<option value="">Selecione a etapa</option>';
            (configData.workflow || []).forEach(step => {
                const fakeOrder = { status: step.name, history: [{ to: step.name }], _raw: {} };
                if (!isOrderFinalized(fakeOrder)) {
                    targetSelect.innerHTML += `<option value="${escapeAdminHtml(step.name)}">${escapeAdminHtml(step.name)}</option>`;
                }
            });
            document.getElementById('adminReopenOrderModal').style.display = 'flex';
        }

        function closeAdminReopenOrderModal() {
            selectedAdminReopenOrderId = null;
            document.getElementById('adminReopenOrderModal').style.display = 'none';
        }

        async function confirmAdminReopenOrder() {
            // Guarda de front-end; o back-end tambem deve validar permissao de Admin nesta acao sensivel.
            if (!isCurrentAdmin()) return Swal.fire('Acesso restrito', 'Apenas Admin pode reabrir pedidos.', 'warning');

            const id = selectedAdminReopenOrderId || document.getElementById('admin-reopen-order-id').value;
            const targetStatus = document.getElementById('admin-reopen-target-status').value;
            const reason = document.getElementById('admin-reopen-reason').value;
            const observation = document.getElementById('admin-reopen-observation').value.trim();
            const order = ordersData.find(x => String(x.id) === String(id));

            if (!order) return Swal.fire('Obrigatório', 'Pedido selecionado obrigatório.', 'warning');
            if (!targetStatus) return Swal.fire('Obrigatório', 'Selecione a etapa de destino.', 'warning');
            if (!reason) return Swal.fire('Obrigatório', 'Selecione o motivo da reabertura.', 'warning');
            if (!observation) return Swal.fire('Obrigatório', 'Informe a observação da reabertura.', 'warning');
            if (!canAdminReopenOrder(order)) return Swal.fire('Ação indisponível', 'Este pedido não pode ser reaberto pela regra atual.', 'warning');

            const confirmation = await Swal.fire({
                title: 'Tem certeza que deseja reabrir este pedido?',
                html: 'Essa ação irá retirar o pedido do status de finalizado e retornar para a etapa selecionada.<br>O histórico será preservado.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sim, reabrir pedido',
                cancelButtonText: 'Cancelar',
                confirmButtonColor: 'var(--cor-alerta)'
            });
            if (!confirmation.isConfirmed) return;

            const reasonLabel = document.getElementById('admin-reopen-reason').selectedOptions[0]?.text || reason;
            const previousStatus = getAdminOrderCurrentStatus(order) || order.status || 'N/D';
            const previousFinalizedAt = getAdminOrderRawValue(order, ['FINALIZADO_EM', 'finalizado_em', 'DATA_FINALIZACAO', 'data_finalizacao']);
            const previousFinalizedBy = getAdminOrderRawValue(order, ['FINALIZADO_POR', 'finalizado_por']);
            const oldHistory = Array.isArray(order.history) ? order.history : [];
            const preservedFinishData = [
                previousFinalizedAt ? `Finalizado em registrado: ${previousFinalizedAt}` : '',
                previousFinalizedBy ? `Finalizado por registrado: ${previousFinalizedBy}` : ''
            ].filter(Boolean).join('. ');
            const historyObs = `Status anterior: ${previousStatus}. Retornado para: ${targetStatus}. Motivo: ${reasonLabel}. Observação: ${observation}. Usuário Admin: ${currentUser || 'Admin'}.${preservedFinishData ? ' ' + preservedFinishData + '.' : ''}`;
            const newEntry = SinalizaCore.buildHistoryEntry('Pedido reaberto pelo Admin', targetStatus, currentUser || 'Admin', reasonLabel, historyObs);
            const newHistory = [...oldHistory, newEntry];
            const payload = { status: targetStatus, history: newHistory, ...SinalizaCore.gerarTimestamps(order.status, targetStatus) };
            const raw = order._raw || {};

            if (raw.FINALIZADO !== undefined || raw.finalizado !== undefined) payload.finalizado = false;
            if (raw.FINALIZADO_EM !== undefined || raw.finalizado_em !== undefined) payload.finalizado_em = null;
            if (raw.DATA_FINALIZACAO !== undefined || raw.data_finalizacao !== undefined) payload.data_finalizacao = null;
            if (raw.STATUS_FINALIZACAO !== undefined || raw.status_finalizacao !== undefined) payload.status_finalizacao = 'reaberto';
            if (raw.REABERTO_EM !== undefined || raw.reaberto_em !== undefined) payload.reaberto_em = new Date().toISOString();
            if (raw.REABERTO_POR !== undefined || raw.reaberto_por !== undefined) payload.reaberto_por = currentUser || 'Admin';

            try {
                await apiFetch(`/pedidos/${id}`, 'PUT', payload);
                closeAdminReopenOrderModal();
                await loadData();
                renderAdminOrdersBase();
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Pedido reaberto com sucesso.', showConfirmButton: false, timer: 3000 });
            } catch(e) {
                Swal.fire('Erro', 'Falha ao reabrir pedido: ' + (e.message || 'Endpoint de reabertura administrativa ainda não implementado.'), 'error');
            }
        }

        function toggleTheme() { const b=document.body; const c=b.getAttribute('data-theme'); const n=c==='dark'?'light':'dark'; b.setAttribute('data-theme',n); localStorage.setItem('theme',n); updateThemeIcon(n); if(paymentChart) { renderSalesDashboard(); } }
        function loadTheme() { const t=localStorage.getItem('theme')||'light'; document.body.setAttribute('data-theme',t); updateThemeIcon(t); }
        function updateThemeIcon(t) { const i=document.getElementById('theme-icon'); const txt=document.getElementById('theme-text'); if(t==='dark'){i.className='ph-fill ph-sun';txt.innerText='Modo Claro';}else{i.className='ph-fill ph-moon';txt.innerText='Modo Escuro';} }
        
        // NOVO: Switch view limpo para a área de Admin
        function switchView(v) { 
            const meta = {
                dash: ['Painel Administrativo', 'Gestão completa do fluxo, usuários, indicadores e pedidos.', 'Painel Master', 'ph-fill ph-shield-check'],
                sales: ['Gestão Comercial', 'Análise consolidada de vendas, faturamento e carteira comercial.', 'Comercial', 'ph-fill ph-briefcase'],
                reports: ['Relatórios Master', 'Inteligência operacional, gargalos e desempenho entre setores.', 'Relatórios', 'ph-fill ph-chart-line-up'],
                'orders-base': ['Base de Pedidos', 'Gestão global de pedidos, histórico e reabertura administrativa.', 'Gestão Global', 'ph-fill ph-database'],
                users: ['Utilizadores', 'Controle de acesso, permissões e usuários internos.', 'Acessos', 'ph-fill ph-users'],
                conf: ['Configurações', 'Workflow, prazos, motivos obrigatórios e regras do sistema.', 'Configurações', 'ph-fill ph-gear']
            };

            if (v === 'orders-base' && !isCurrentAdmin()) {
                Swal.fire('Acesso restrito', 'Apenas Admin pode abrir a Base de Pedidos.', 'warning');
                v = 'dash';
            }

            ['dash','reports','gargalos','orders-base','users','conf','sales'].forEach(x=>{ 
                const view = document.getElementById('view-'+x);
                if(view) view.classList.add('hidden'); 
                const btn = document.getElementById('btn-'+x);
                if(btn) btn.classList.remove('active'); 
            }); 
            
            const activeView = document.getElementById('view-'+v);
            if(activeView) activeView.classList.remove('hidden'); 
            
            const activeBtn = document.getElementById('btn-'+v);
            if(activeBtn) activeBtn.classList.add('active');

            const data = v === 'gargalos'
                ? ['Análise de Gargalos', 'Lead time bruto, ocorrências, retornos e gargalos por setor.', 'Gargalos', 'ph-fill ph-warning-diamond']
                : (meta[v] || meta.dash);
            const pageTitle = document.getElementById('page-title');
            const pageSubtitle = document.getElementById('page-subtitle');
            const overline = document.querySelector('.page-overline');
            if(pageTitle) pageTitle.innerText = data[0];
            if(pageSubtitle) pageSubtitle.innerText = data[1];
            if(overline) overline.innerHTML = `<i class="${data[3]}"></i> ${data[2]}`;
            
            if(v==='reports') renderReports(); 
            if(v==='gargalos') processAdminBottlenecks();
            if(v==='orders-base') renderAdminOrdersBase();
            if(v==='users') loadUsers(); 
            if(v==='sales') { populateSalesPersonFilter(); renderSalesDashboard(); } 
        }
        
        let adminBottleneckData = [];

        function getAdminDomId(id) {
            return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        }

        function diffMinsCalcAdmin(start, end) {
            if (!start || !end) return 0;
            const diff = (new Date(end) - new Date(start)) / 60000;
            return diff > 0 ? diff : 0;
        }

        function formatLeadTimeAdmin(mins) {
            if (!mins || isNaN(mins) || mins <= 0) return '0m';
            if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
            if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
            return `${Math.round(mins)}m`;
        }

        function getAdminBottleneckStages() {
            const workflow = configData.workflow || [];
            return {
                finalStage: workflow.length > 0 ? getSafeStatus(workflow[workflow.length - 1].name) : 'finalizado',
                fatStages: workflow.filter(w => getSafeStatus(w.role).includes('faturamento') || getSafeStatus(w.name).includes('faturam')).map(w => getSafeStatus(w.name)),
                layStages: workflow.filter(w => getSafeStatus(w.role).includes('layout') || getSafeStatus(w.name).includes('layout')).map(w => getSafeStatus(w.name)),
                pcpStages: workflow.filter(w => getSafeStatus(w.role).includes('pcp') || getSafeStatus(w.name).includes('pcp')).map(w => getSafeStatus(w.name)),
                prodStages: workflow.filter(w => {
                    const role = getSafeStatus(w.role);
                    return role.includes('produc') || role.includes('produÃ§');
                }).map(w => getSafeStatus(w.name))
            };
        }

        function processAdminBottlenecks() {
            const kpiContainer = document.getElementById('gargalos-kpi-container');
            const listContainer = document.getElementById('gargalos-orders-list');
            if (!kpiContainer || !listContainer) return;

            if (!configData.workflow || configData.workflow.length === 0) {
                kpiContainer.innerHTML = '';
                listContainer.innerHTML = '<div style="text-align:center; padding:50px; color:var(--cor-texto-mutado);">Aguardando configuraÃ§Ãµes de workflow.</div>';
                return;
            }

            const stages = getAdminBottleneckStages();
            adminBottleneckData = [];

            let totalLay = 0, countLay = 0;
            let totalPcp = 0, countPcp = 0;
            let totalProd = 0, countProd = 0;
            let totalFat = 0, countFat = 0;
            let totalOccurrences = 0;

            ordersData.forEach(o => {
                const logs = (o.history || [])
                    .filter(h => h && h.date && !isNaN(new Date(h.date).getTime()))
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                let currentOrderStatus = getSafeStatus(o.status);
                if (logs.length > 0 && logs[logs.length - 1].to) currentOrderStatus = getSafeStatus(logs[logs.length - 1].to);

                const isFat = stages.fatStages.includes(currentOrderStatus) || currentOrderStatus.includes('faturam') || currentOrderStatus.includes('nota');
                const isFinal = currentOrderStatus === stages.finalStage || currentOrderStatus.includes('finalizad') || currentOrderStatus.includes('concluid') || currentOrderStatus.includes('entregue') || logs.some(h => String(h.action || '').toLowerCase().includes('nota emitida'));
                if (!isFat && !isFinal) return;

                const finishedDate = logs.length > 0 ? new Date(logs[logs.length - 1].date) : new Date(o.created_at || o.issue_date || Date.now());
                let lastDate = new Date(o.created_at || o.issue_date || o.delivery || finishedDate);
                if (isNaN(lastDate.getTime()) && logs.length > 0) lastDate = new Date(logs[0].date);

                let currentStatus = logs.length > 0 ? getSafeStatus(logs[0].from || logs[0].to) : getSafeStatus(o.status);

                const row = {
                    id: o.id,
                    client: o.client || '-',
                    timeLay: 0,
                    timePcp: 0,
                    timeProd: 0,
                    timeFat: 0,
                    usersLay: new Set(),
                    usersPcp: new Set(),
                    usersProd: new Set(),
                    usersFat: new Set(),
                    errors: [],
                    finishedDate
                };

                logs.forEach((log, logIndex) => {
                    const logDate = new Date(log.date);
                    if (isNaN(logDate.getTime()) || logDate < lastDate) return;

                    const mins = diffMinsCalcAdmin(lastDate, logDate);
                    if (mins > 0 && mins < 43200) {
                        if (stages.layStages.includes(currentStatus)) row.timeLay += mins;
                        else if (stages.prodStages.includes(currentStatus)) row.timeProd += mins;
                        else if (stages.pcpStages.includes(currentStatus) || currentStatus.includes('pcp') || currentStatus.includes('libera')) row.timePcp += mins;
                        else if (stages.fatStages.includes(currentStatus) || currentStatus.includes('faturam')) row.timeFat += mins;
                    }

                    const action = String(log.action || '').toLowerCase();
                    const user = normalizarNome(log.user);

                    if (user && user !== 'Sistema') {
                        if (action.includes('projeto inici') || action.includes('projeto final') || action.includes('enviado ao cliente') || action.includes('cliente apro') || action.includes('layout') || action.includes('arte')) row.usersLay.add(user);
                        else if (action.includes('pcp')) row.usersPcp.add(user);
                        else if (action.includes('produÃ§') || action.includes('produc') || action.includes('mÃ¡quina') || action.includes('bancada') || action.includes('expediÃ§Ã£o')) row.usersProd.add(user);
                        else if (action.includes('faturam') || action.includes('nota emitida')) row.usersFat.add(user);
                    }

                    if (action.includes('devoluÃ§Ã£o') || action.includes('retorno') || action.includes('reprov') || action.includes('problema') || action.includes('estendido') || action.includes('justificativa')) {
                        const obs = log.obs ? String(log.obs).replace(/\[Motivo:/i, 'Motivo:').replace(/\]/g, '').trim() : '';
                        row.errors.push({ date: logDate, action: log.action || 'OcorrÃªncia', user: user || 'Sistema', obs });
                        totalOccurrences++;
                    }

                    const logTo = getSafeStatus(log.to);
                    if (logTo) currentStatus = logTo;
                    lastDate = logDate;
                });

                const finalMins = diffMinsCalcAdmin(lastDate, row.finishedDate);
                if (finalMins > 0 && finalMins < 43200) {
                    if (stages.layStages.includes(currentStatus)) row.timeLay += finalMins;
                    else if (stages.prodStages.includes(currentStatus)) row.timeProd += finalMins;
                    else if (stages.pcpStages.includes(currentStatus) || currentStatus.includes('pcp')) row.timePcp += finalMins;
                    else if (stages.fatStages.includes(currentStatus) || currentStatus.includes('faturam')) row.timeFat += finalMins;
                }

                if (row.timeLay > 0) { totalLay += row.timeLay; countLay++; }
                if (row.timePcp > 0) { totalPcp += row.timePcp; countPcp++; }
                if (row.timeProd > 0) { totalProd += row.timeProd; countProd++; }
                if (row.timeFat > 0) { totalFat += row.timeFat; countFat++; }

                row.usersLay = Array.from(row.usersLay).join(', ');
                row.usersPcp = Array.from(row.usersPcp).join(', ');
                row.usersProd = Array.from(row.usersProd).join(', ');
                row.usersFat = Array.from(row.usersFat).join(', ');
                adminBottleneckData.push(row);
            });

            adminBottleneckData.sort((a, b) => b.finishedDate - a.finishedDate);

            kpiContainer.innerHTML = `
                ${createKPI('Layout', formatAvgTime(countLay > 0 ? totalLay / countLay : 0), 'ph-fill ph-paint-brush', 'var(--cor-primaria)')}
                ${createKPI('PCP', formatAvgTime(countPcp > 0 ? totalPcp / countPcp : 0), 'ph-fill ph-clipboard-text', 'var(--cor-alerta)')}
                ${createKPI('Fábrica', formatAvgTime(countProd > 0 ? totalProd / countProd : 0), 'ph-fill ph-hammer', 'var(--cor-info)')}
                ${createKPI('Ocorrências', totalOccurrences, 'ph-fill ph-warning-octagon', 'var(--cor-erro)')}
            `;

            renderAdminBottleneckList();
        }

        function renderAdminBottleneckList() {
            const container = document.getElementById('gargalos-orders-list');
            if (!container) return;

            const searchEl = document.getElementById('gargalos-search-input');
            const filterEl = document.getElementById('gargalos-filter-errors');
            const search = searchEl ? searchEl.value.toLowerCase().trim() : '';
            const filter = filterEl ? filterEl.value : 'all';

            let filtered = adminBottleneckData;
            if (filter === 'errors_only') filtered = filtered.filter(o => o.errors.length > 0);
            if (search) filtered = filtered.filter(o => String(o.id).toLowerCase().includes(search) || String(o.client || '').toLowerCase().includes(search));

            if (filtered.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:50px; color:var(--cor-texto-mutado);">Nenhum gargalo encontrado para estes filtros.</div>';
                return;
            }

            container.innerHTML = filtered.map(o => {
                const totalMins = o.timeLay + o.timePcp + o.timeProd + o.timeFat;
                const hasErrors = o.errors.length > 0;
                const rowId = getAdminDomId(o.id);
                const errorsHtml = hasErrors ? `
                    <div class="admin-error-block">
                        <div class="admin-error-title"><i class="ph-fill ph-warning-octagon"></i> OcorrÃªncias registradas</div>
                        ${o.errors.map(e => `
                            <div class="admin-error-item">
                                <strong>${e.action}</strong>
                                <span>${e.obs || 'Sem observaÃ§Ã£o registrada.'}</span>
                                <small>${e.user} â€¢ ${e.date.toLocaleString('pt-BR')}</small>
                            </div>
                        `).join('')}
                    </div>
                ` : '';

                return `
                    <div class="list-row admin-bottleneck-row ${hasErrors ? 'has-error' : 'no-error'}" id="gargalo-row-${rowId}">
                        <div class="row-header" onclick="toggleAdminBottleneckCard('${rowId}')">
                            <div class="col-info">
                                <span class="row-id">#${o.id}</span>
                                <div class="row-client">${o.client}</div>
                                <div class="info-praz"><i class="ph-bold ph-check-circle"></i> ConcluÃ­do em ${o.finishedDate.toLocaleDateString('pt-BR')}</div>
                            </div>
                            <div class="admin-bottleneck-summary">
                                <span><i class="ph-bold ph-clock"></i> Lead time: ${formatLeadTimeAdmin(totalMins)}</span>
                                ${hasErrors ? `<span class="is-danger"><i class="ph-bold ph-warning-octagon"></i> ${o.errors.length} ocorrÃªncia(s)</span>` : '<span><i class="ph-bold ph-check-circle"></i> Sem ocorrÃªncias</span>'}
                            </div>
                            <div class="col-actions">
                                <button class="btn btn-secondary" type="button">Raio-X <i class="ph-bold ph-caret-down"></i></button>
                            </div>
                        </div>
                        <div class="card-details" onclick="event.stopPropagation()">
                            <div class="admin-sector-timeline">
                                <div class="admin-sector-step"><strong>Layout</strong><span>${formatLeadTimeAdmin(o.timeLay)}</span><small>${o.usersLay || 'N/D'}</small></div>
                                <div class="admin-sector-step"><strong>PCP</strong><span>${formatLeadTimeAdmin(o.timePcp)}</span><small>${o.usersPcp || 'N/D'}</small></div>
                                <div class="admin-sector-step"><strong>FÃ¡brica</strong><span>${formatLeadTimeAdmin(o.timeProd)}</span><small>${o.usersProd || 'N/D'}</small></div>
                                <div class="admin-sector-step"><strong>EmissÃ£o</strong><span>${formatLeadTimeAdmin(o.timeFat)}</span><small>${o.usersFat || 'N/D'}</small></div>
                            </div>
                            ${errorsHtml}
                        </div>
                    </div>
                `;
            }).join('')
                .replaceAll('Ocorr\u00c3\u00aancias', 'Ocorrências')
                .replaceAll('Ocorr\u00c3\u00aancia', 'Ocorrência')
                .replaceAll('ocorr\u00c3\u00aancias', 'ocorrências')
                .replaceAll('ocorr\u00c3\u00aancia', 'ocorrência')
                .replaceAll('observa\u00c3\u00a7\u00c3\u00a3o', 'observação')
                .replaceAll('Conclu\u00c3\u00addo', 'Concluído')
                .replaceAll('F\u00c3\u00a1brica', 'Fábrica')
                .replaceAll('Emiss\u00c3\u00a3o', 'Emissão')
                .replaceAll('\u00e2\u20ac\u00a2', '•');
        }

        function toggleAdminBottleneckCard(rowId) {
            const row = document.getElementById(`gargalo-row-${rowId}`);
            if (row) row.classList.toggle('is-expanded');
        }

        function updateKPIs() {
            const container = document.getElementById('kpi-container');
            if (!container) return;

            let naFabrica = 0;
            let finalizadosHoje = 0;
            
            const now = new Date();
            const todayYear = now.getFullYear();
            const todayMonth = now.getMonth();
            const todayDate = now.getDate();

            const stepCounts = {};
            if (configData.workflow) {
                configData.workflow.forEach(w => stepCounts[w.name] = 0);
            }

            const finalStage = (configData.workflow && configData.workflow.length > 0) ? getSafeStatus(configData.workflow[configData.workflow.length-1].name) : 'finalizado';
            const firstStage = (configData.workflow && configData.workflow.length > 0) ? getSafeStatus(configData.workflow[0].name) : 'comercial';

            ordersData.forEach(o => {
                let st = getSafeStatus(o.status);
                if (o.history && o.history.length > 0) {
                    const lastLog = o.history[o.history.length - 1];
                    if (lastLog.to) st = getSafeStatus(lastLog.to);
                }
                
                if (st === 'finalizado' || st === 'concluido' || st === 'entregue') {
                    st = finalStage;
                }

                // 1. Conta Pedidos por Etapa do Workflow
                let foundStep = false;
                if (configData.workflow) {
                    const realStep = configData.workflow.find(w => getSafeStatus(w.name) === st);
                    if (realStep) {
                        stepCounts[realStep.name]++;
                        foundStep = true;
                    }
                }
                if (!foundStep && stepCounts[o.status] !== undefined) {
                    stepCounts[o.status]++;
                }

                // 2. Conta "Na Fábrica" (Tudo que já passou do Comercial e não está Finalizado)
                if (st !== firstStage && st !== finalStage) {
                    naFabrica++;
                }

                // 3. Conta "Finalizados Hoje"
                if (st === finalStage) {
                    let fatDate = null;
                    const hist = o.history || [];
                    if (hist.length > 0) {
                        let fatLog = [...hist].reverse().find(h => getSafeStatus(h.to) === finalStage);
                        if (!fatLog) fatLog = hist[hist.length - 1];
                        if (fatLog && fatLog.date) fatDate = new Date(fatLog.date);
                    }
                    if (!fatDate && (o.issue_date || o.created_at)) {
                        let dStr = o.issue_date || o.created_at;
                        if (dStr.length === 10) dStr += 'T12:00:00';
                        fatDate = new Date(dStr);
                    }
                    
                    // Valida se a data bate com o dia de hoje
                    if (fatDate && fatDate.getFullYear() === todayYear && fatDate.getMonth() === todayMonth && fatDate.getDate() === todayDate) {
                        finalizadosHoje++;
                    }
                }
            });

            // ==========================================
            // GERAÇÃO DO HTML (Cores e Ícones Originais)
            // ==========================================
            let html = createKPI('Na Fábrica', naFabrica, 'ph-list-numbers', '#EFF6FF', '#2563EB');

            const colors = [
                { bg: '#EFF6FF', color: '#2563EB' }, // Comercial (Azul)
                { bg: '#EDE9FE', color: '#8B5CF6' }, // Layout (Roxo)
                { bg: '#FEF3C7', color: '#D97706' }, // PCP (Amarelo)
                { bg: '#FEE2E2', color: '#EF4444' }, // Produção (Vermelho)
                { bg: '#D1FAE5', color: '#10B981' }  // Faturamento (Verde)
            ];

            if (configData.workflow) {
                configData.workflow.forEach((w, idx) => {
                    if (idx === configData.workflow.length - 1) return; // Pula o cartão final (já temos "Finalizados Hoje")
                    const c = colors[idx % colors.length];
                    html += createKPI(w.name, stepCounts[w.name], 'ph-layout', c.bg, c.color);
                });
            }

            html += createKPI('Finalizados Hoje', finalizadosHoje, 'ph-check-circle', '#D1FAE5', '#10B981');

            container.innerHTML = html;
        }
        function createKPI(lbl, val, icon, bg, color) { const filterVal = lbl === 'Na Fábrica' ? 'all' : lbl; return `<div class="kpi-card" onclick="setFilter('${filterVal}')"><div><span class="kpi-label">${lbl}</span><div class="kpi-val">${val}</div></div><div class="kpi-icon" style="background:${bg}; color:${color};"><i class="ph-bold ${icon}"></i></div></div>`; }

        function renderReasonsConfig() {
            const container = document.getElementById('reasons-container'); container.innerHTML = '';
            const sectors = [ { id: 'layout', name: 'Layout' }, { id: 'pcp', name: 'PCP' }, { id: 'producao', name: 'Produção' }, { id: 'faturamento', name: 'Faturamento' }, { id: 'comercial', name: 'Comercial' } ];
            
            sectors.forEach(sec => {
                const reasons = configData.movementReasons[sec.id] || {};
                const fwdList = reasons.forward || [];
                let fwdTags = fwdList.map((r, i) => `<div class="reason-tag" style="background:#D1FAE5; color:#059669; border:none;"><span>${r}</span><button onclick="removeReason('${sec.id}', 'forward', ${i})"><i class="ph-bold ph-x"></i></button></div>`).join('');
                
                let bwdHtml = '';

                if (sec.id === 'faturamento') {
                    const bwdProdList = reasons.backward_producao || [];
                    const bwdComList = reasons.backward_comercial || [];
                    let bwdProdTags = bwdProdList.map((r, i) => `<div class="reason-tag" style="background:#FEE2E2; color:#DC2626; border:none;"><span>${r}</span><button onclick="removeReason('${sec.id}', 'backward_producao', ${i})"><i class="ph-bold ph-x"></i></button></div>`).join('');
                    let bwdComTags = bwdComList.map((r, i) => `<div class="reason-tag" style="background:#FEF3C7; color:#D97706; border:none;"><span>${r}</span><button onclick="removeReason('${sec.id}', 'backward_comercial', ${i})"><i class="ph-bold ph-x"></i></button></div>`).join('');

                    bwdHtml = `
                        <div style="background: var(--cor-card-bg); border: 1px solid var(--cor-borda); padding: 15px; border-radius: var(--radius-padrao); margin-bottom: 10px;">
                            <div style="font-size: 0.8rem; font-weight: 700; color: var(--cor-erro); margin-bottom: 10px;">Retornar p/ Produção</div>
                            <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                                <input type="text" id="input-bwd-prod-${sec.id}" class="config-input" placeholder="Novo motivo..." style="margin:0; flex:1;">
                                <button class="btn btn-danger btn-icon-only" onclick="addReason('${sec.id}', 'backward_producao')"><i class="ph-bold ph-plus"></i></button>
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 5px;">${bwdProdTags || '<span style="font-size:0.8rem; color:var(--cor-texto-mutado)">Nenhum</span>'}</div>
                        </div>
                        <div style="background: var(--cor-card-bg); border: 1px solid var(--cor-borda); padding: 15px; border-radius: var(--radius-padrao);">
                            <div style="font-size: 0.8rem; font-weight: 700; color: var(--cor-alerta); margin-bottom: 10px;">Retornar p/ Comercial</div>
                            <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                                <input type="text" id="input-bwd-com-${sec.id}" class="config-input" placeholder="Novo motivo..." style="margin:0; flex:1;">
                                <button class="btn btn-warning btn-icon-only" onclick="addReason('${sec.id}', 'backward_comercial')"><i class="ph-bold ph-plus"></i></button>
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 5px;">${bwdComTags || '<span style="font-size:0.8rem; color:var(--cor-texto-mutado)">Nenhum</span>'}</div>
                        </div>
                    `;
                } else {
                    const bwdList = reasons.backward || [];
                    let bwdTags = bwdList.map((r, i) => `<div class="reason-tag" style="background:#FEE2E2; color:#DC2626; border:none;"><span>${r}</span><button onclick="removeReason('${sec.id}', 'backward', ${i})"><i class="ph-bold ph-x"></i></button></div>`).join('');
                    bwdHtml = `
                        <div style="background: var(--cor-card-bg); border: 1px solid var(--cor-borda); padding: 15px; border-radius: var(--radius-padrao); height: 100%;">
                            <div style="font-size: 0.8rem; font-weight: 700; color: var(--cor-erro); margin-bottom: 10px;">Retornar Etapa</div>
                            <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                                <input type="text" id="input-bwd-${sec.id}" class="config-input" placeholder="Novo motivo..." style="margin:0; flex:1;">
                                <button class="btn btn-danger btn-icon-only" onclick="addReason('${sec.id}', 'backward')"><i class="ph-bold ph-plus"></i></button>
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 5px;">${bwdTags || '<span style="font-size:0.8rem; color:var(--cor-texto-mutado)">Nenhum</span>'}</div>
                        </div>
                    `;
                }

                container.innerHTML += `
                    <div style="padding-bottom: 20px; border-bottom: 1px solid var(--cor-borda); margin-bottom: 10px;">
                        <h4 style="margin-bottom: 15px; font-size: 1rem; font-weight: 700;"><i class="ph-bold ph-folder" style="color:var(--cor-primaria); margin-right:6px;"></i>${sec.name}</h4>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; align-items: start;">
                            <div style="background: var(--cor-card-bg); border: 1px solid var(--cor-borda); padding: 15px; border-radius: var(--radius-padrao);">
                                <div style="font-size: 0.8rem; font-weight: 700; color: var(--cor-sucesso); margin-bottom: 10px;">Avançar Etapa</div>
                                <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                                    <input type="text" id="input-fwd-${sec.id}" class="config-input" placeholder="Novo motivo..." style="margin:0; flex:1;">
                                    <button class="btn btn-success btn-icon-only" onclick="addReason('${sec.id}', 'forward')"><i class="ph-bold ph-plus"></i></button>
                                </div>
                                <div style="display: flex; flex-wrap: wrap; gap: 5px;">${fwdTags || '<span style="font-size:0.8rem; color:var(--cor-texto-mutado)">Nenhum</span>'}</div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                ${bwdHtml}
                            </div>
                        </div>
                    </div>`;
            });
        }
        
        function addReason(sector, type) { 
            let inputId = `input-fwd-${sector}`;
            if (type === 'backward') inputId = `input-bwd-${sector}`;
            if (type === 'backward_producao') inputId = `input-bwd-prod-${sector}`;
            if (type === 'backward_comercial') inputId = `input-bwd-com-${sector}`;

            const val = document.getElementById(inputId).value.trim(); 
            if(val) { 
                if(!configData.movementReasons[sector]) configData.movementReasons[sector] = {}; 
                if(!configData.movementReasons[sector][type]) configData.movementReasons[sector][type] = [];
                configData.movementReasons[sector][type].push(val); 
                renderReasonsConfig(); 
            } 
        }
        
        function removeReason(sector, type, index) { 
            Swal.fire({title: 'Remover motivo?', icon: 'warning', showCancelButton: true}).then((r) => { 
                if(r.isConfirmed) { 
                    configData.movementReasons[sector][type].splice(index, 1); 
                    renderReasonsConfig(); 
                }
            }); 
        }

        // ==============================================================
        // 🚀 MÁQUINA DE BI (GARGALOS, TEMPOS E MOTIVOS)
        // ==============================================================
        function formatAvgTime(mins) {
            if (!mins || isNaN(mins) || mins <= 0) return '0m';
            if (mins >= 1440) return `${(mins / 1440).toFixed(1)} dias`;
            if (mins >= 60) return `${(mins / 60).toFixed(1)} hrs`;
            return `${Math.round(mins)} min`;
        }

        function normalizarNome(nome) {
            if(!nome) return null;
            const n = String(nome).toLowerCase().trim();
            return n.charAt(0).toUpperCase() + n.slice(1);
        }

        function getRoleOfStatus(st) {
            const w = configData.workflow.find(x => getSafeStatus(x.name) === getSafeStatus(st));
            return w ? w.role : 'comercial';
        }

        function renderReports() {
            const loading = document.getElementById('reports-loading-state');
            const content = document.getElementById('reports-content');
            const container = document.getElementById('sectors-container');
            if (!container) return;

            if (loading) loading.style.display = 'block';
            if (content) content.style.display = 'none';

            if (!configData.workflow || configData.workflow.length === 0) {
                container.innerHTML = '<div class="empty-state">Aguardando configura&ccedil;&atilde;o de workflow.</div>';
                if (loading) loading.style.display = 'none';
                if (content) content.style.display = 'flex';
                return;
            }

            const TEAM_LAY  = ['CHRYS', 'LUCAS', 'ANA'];
            const TEAM_PCP  = ['BRENO'];
            const TEAM_PROD = ['ANDERSON'];
            const TEAM_FAT  = ['SORAIA'];

            const normalizeSearch = (value) => String(value || '')
                .trim()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');

            const reportName = (name) => {
                if (!name) return null;
                const normalized = String(name).trim();
                if (!normalized || normalizeSearch(normalized) === 'sistema') return null;
                return normalized.toUpperCase();
            };

            const reportStatus = (value) => normalizeSearch(value);
            const hasAny = (value, terms) => terms.some(term => value.includes(term));
            const finalStage = reportStatus(configData.workflow[configData.workflow.length - 1].name) || 'finalizado';
            const layStages = configData.workflow.filter(w => reportStatus(w.role).includes('layout') || reportStatus(w.name).includes('layout')).map(w => reportStatus(w.name));
            const pcpStages = configData.workflow.filter(w => reportStatus(w.role).includes('pcp') || reportStatus(w.name).includes('pcp')).map(w => reportStatus(w.name));
            const prodStages = configData.workflow.filter(w => reportStatus(w.role).includes('produc') || reportStatus(w.name).includes('produc')).map(w => reportStatus(w.name));
            const fatStages = configData.workflow.filter(w => reportStatus(w.role).includes('faturamento') || reportStatus(w.name).includes('faturam')).map(w => reportStatus(w.name));

            const formatReportLeadTime = (mins) => {
                if (!mins || isNaN(mins) || mins <= 0) return '0m';
                if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
                if (mins >= 60) return `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m`;
                return `${Math.round(mins)}m`;
            };

            const friendlyMonth = (monthKey) => {
                if (!monthKey) return 'N/D';
                const parts = monthKey.split('-');
                if (parts.length !== 2) return monthKey;
                const date = new Date(parts[0], parseInt(parts[1], 10) - 1, 1);
                return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(' de ', '/');
            };

            const stats = {
                lay: { name: 'Cria&ccedil;&atilde;o (Layout)', color: 'var(--cor-primaria)', bg: 'var(--cor-primaria-soft-bg)', icon: 'ph-paint-brush', users: {}, monthly: {}, totalTime: 0, count: 0 },
                pcp: { name: 'Libera&ccedil;&atilde;o (PCP)', color: 'var(--cor-alerta)', bg: 'rgba(245,158,11,0.12)', icon: 'ph-clipboard-text', users: {}, monthly: {}, totalTime: 0, count: 0 },
                prod: { name: 'F&aacute;brica (Produ&ccedil;&atilde;o)', color: 'var(--cor-sucesso)', bg: 'rgba(16,185,129,0.12)', icon: 'ph-hammer', users: {}, monthly: {}, totalTime: 0, count: 0 },
                fat: { name: 'Emiss&atilde;o (Faturamento)', color: 'var(--cor-erro)', bg: 'rgba(239,68,68,0.10)', icon: 'ph-receipt', users: {}, monthly: {}, totalTime: 0, count: 0 }
            };

            TEAM_LAY.forEach(n => stats.lay.users[n] = { time: 0, count: 0 });
            TEAM_PCP.forEach(n => stats.pcp.users[n] = { time: 0, count: 0 });
            TEAM_PROD.forEach(n => stats.prod.users[n] = { time: 0, count: 0 });
            TEAM_FAT.forEach(n => stats.fat.users[n] = { time: 0, count: 0 });

            const now = new Date();

            ordersData.forEach(o => {
                const logs = Array.isArray(o.history) ? o.history : [];
                if (logs.length === 0) return;

                const revLogs = [...logs].reverse();

                const lLog = revLogs.find(h => {
                    const act = normalizeSearch(h.action);
                    const toStatus = reportStatus(h.to);
                    const isFinishing = hasAny(act, ['finalizad', 'arte finalizada', 'concluid', 'cliente aprovou', 'encaminhad']);
                    const isMovingOut = toStatus !== '' && !layStages.includes(toStatus);
                    const isReturn = hasAny(act, ['retorno', 'reprov']);
                    return TEAM_LAY.includes(reportName(h.user)) && (isFinishing || isMovingOut) && !isReturn;
                });
                const layDeliverer = lLog ? reportName(lLog.user) : null;

                const prLog = revLogs.find(h => {
                    const act = normalizeSearch(h.action);
                    const toStatus = reportStatus(h.to);
                    const isFinishing = hasAny(act, ['finalizad', 'concluid']);
                    const isMovingOut = toStatus !== '' && !prodStages.includes(toStatus);
                    const isReturn = hasAny(act, ['retorno', 'reprov']);
                    return TEAM_PROD.includes(reportName(h.user)) && (isFinishing || isMovingOut) && !isReturn;
                });
                const prodDeliverer = prLog ? reportName(prLog.user) : null;

                const pcLog = revLogs.find(h => {
                    const act = normalizeSearch(h.action);
                    const toStatus = reportStatus(h.to);
                    const isFinishing = hasAny(act, ['liberad', 'avanco', 'concluid']);
                    const isMovingOut = toStatus !== '' && !pcpStages.includes(toStatus);
                    const isReturn = hasAny(act, ['retorno', 'reprov']);
                    return TEAM_PCP.includes(reportName(h.user)) && (isFinishing || isMovingOut) && !isReturn;
                });
                const pcpDeliverer = pcLog ? reportName(pcLog.user) : null;

                const ftLog = revLogs.find(h => {
                    const act = normalizeSearch(h.action);
                    const toStatus = reportStatus(h.to);
                    const isFinishing = hasAny(act, ['faturad', 'nota', 'finalizad']);
                    const isMovingOut = toStatus === finalStage || (toStatus !== '' && !fatStages.includes(toStatus));
                    const isReturn = hasAny(act, ['retorno', 'reprov']);
                    return TEAM_FAT.includes(reportName(h.user)) && (isFinishing || isMovingOut) && !isReturn;
                });
                const fatDeliverer = ftLog ? reportName(ftLog.user) : null;

                let orderTimeLay = 0, orderTimeProd = 0, orderTimePcp = 0, orderTimeFat = 0;
                let lastDate = new Date(o.created_at || o.issue_date || o.DATA_EMISSAO);
                if (isNaN(lastDate.getTime()) && logs.length > 0) lastDate = new Date(logs[0].date);

                let currentStatus = logs.length > 0 ? (reportStatus(logs[0].from) || reportStatus(logs[0].to)) : reportStatus(o.status);

                logs.forEach((log, logIndex) => {
                    const logDate = new Date(log.date);
                    if (isNaN(logDate.getTime()) || logDate < lastDate) return;

                    const mins = diffMinsCalcAdmin(lastDate, logDate);
                    if (mins > 0 && mins < 43200) {
                        if (layStages.includes(currentStatus)) orderTimeLay += mins;
                        else if (prodStages.includes(currentStatus)) orderTimeProd += mins;
                        else if (pcpStages.includes(currentStatus) || currentStatus.includes('pcp') || currentStatus.includes('libera')) orderTimePcp += mins;
                        else if (fatStages.includes(currentStatus) || currentStatus.includes('faturam')) orderTimeFat += mins;
                    }

                    const logTo = reportStatus(log.to);
                    if (logTo) currentStatus = logTo;
                    lastDate = logDate;
                });

                const st = reportStatus(o.status);
                const isFinished = st === finalStage || hasAny(st, ['finalizad', 'concluid', 'entregue']) || logs.some(h => normalizeSearch(h.action).includes('nota emitida'));
                const endTime = isFinished ? (logs.length > 0 ? new Date(logs[logs.length - 1].date) : new Date(o.created_at || o.issue_date)) : now;
                const finalMins = diffMinsCalcAdmin(lastDate, endTime);

                if (finalMins > 0 && finalMins < 43200) {
                    if (layStages.includes(currentStatus)) orderTimeLay += finalMins;
                    else if (prodStages.includes(currentStatus)) orderTimeProd += finalMins;
                    else if (pcpStages.includes(currentStatus) || currentStatus.includes('pcp')) orderTimePcp += finalMins;
                    else if (fatStages.includes(currentStatus) || currentStatus.includes('faturam')) orderTimeFat += finalMins;
                }

                const addClosed = (sector, user, log, minutes) => {
                    if (!user || !log) return;
                    if (!sector.users[user]) sector.users[user] = { time: 0, count: 0 };
                    sector.count++;
                    sector.totalTime += minutes;
                    sector.users[user].count++;
                    sector.users[user].time += minutes;

                    const monthDate = new Date(log.date);
                    if (!isNaN(monthDate.getTime())) {
                        const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
                        if (!sector.monthly[monthKey]) sector.monthly[monthKey] = { time: 0, count: 0 };
                        sector.monthly[monthKey].time += minutes;
                        sector.monthly[monthKey].count++;
                    }
                };

                const addActiveTime = (sector, stages, minutes) => {
                    if (!stages.includes(currentStatus)) return;
                    const inLog = revLogs.find(h => {
                        const act = normalizeSearch(h.action);
                        return hasAny(act, ['iniciad', 'inicio', 'assumi']) && sector.team.includes(reportName(h.user));
                    });
                    const activeUser = inLog ? reportName(inLog.user) : null;
                    if (activeUser && sector.users[activeUser]) sector.users[activeUser].time += minutes;
                };

                stats.lay.team = TEAM_LAY;
                stats.prod.team = TEAM_PROD;
                stats.pcp.team = TEAM_PCP;
                stats.fat.team = TEAM_FAT;

                if (layDeliverer) addClosed(stats.lay, layDeliverer, lLog, orderTimeLay);
                else addActiveTime(stats.lay, layStages, orderTimeLay);

                if (prodDeliverer) addClosed(stats.prod, prodDeliverer, prLog, orderTimeProd);
                else addActiveTime(stats.prod, prodStages, orderTimeProd);

                if (pcpDeliverer) addClosed(stats.pcp, pcpDeliverer, pcLog, orderTimePcp);
                else addActiveTime(stats.pcp, pcpStages, orderTimePcp);

                if (fatDeliverer) addClosed(stats.fat, fatDeliverer, ftLog, orderTimeFat);
                else addActiveTime(stats.fat, fatStages, orderTimeFat);
            });

            const orderedKeys = ['lay', 'pcp', 'prod', 'fat'];
            let html = '';

            orderedKeys.forEach(key => {
                const s = stats[key];
                const sectorAvg = s.count > 0 ? formatReportLeadTime(s.totalTime / s.count) : '0m';
                const sortedMonths = Object.keys(s.monthly).sort();
                const monthlyHtml = sortedMonths.length > 0 ? sortedMonths.map(monthKey => {
                    const month = s.monthly[monthKey];
                    const avg = formatReportLeadTime(month.time / month.count);
                    return `
                        <div class="monthly-card" style="border-top-color:${s.color};">
                            <div class="monthly-title">${friendlyMonth(monthKey)}</div>
                            <div class="monthly-stat"><span>Volume Finalizado:</span><strong>${month.count}</strong></div>
                            <div class="monthly-val" style="color:${s.color};" title="Tempo Medio Mensal">${avg}</div>
                        </div>`;
                }).join('') : '<div class="reports-empty-inline">Sem entregas concluidas neste periodo.</div>';

                const sortedUsers = Object.keys(s.users).sort((a, b) => s.users[b].count - s.users[a].count || a.localeCompare(b));
                const usersHtml = sortedUsers.map(user => {
                    const u = s.users[user];
                    const avg = u.count > 0 ? formatReportLeadTime(u.time / u.count) : `${formatReportLeadTime(u.time)} (Ativo)`;
                    return `
                        <div class="gamer-card">
                            <div class="gamer-header" style="background:${s.color};">
                                <div class="avatar-circle">${user.charAt(0)}</div>
                                <div class="gamer-name">${user}</div>
                            </div>
                            <div class="gamer-body">
                                <div class="bucket-row">
                                    <span class="bucket-label"><i class="ph-fill ph-check-circle"></i> Entregas Concluidas</span>
                                    <span class="bucket-val">${u.count}</span>
                                </div>
                                <div class="bucket-row" style="background:${s.bg}; border-color:${s.color};">
                                    <span class="bucket-label" style="color:${s.color};"><i class="ph-bold ph-clock"></i> Lead Time do Ticket</span>
                                    <span class="bucket-val" style="color:${s.color};">${avg}</span>
                                </div>
                            </div>
                        </div>`;
                }).join('');

                html += `
                    <div class="sector-block">
                        <div class="sector-header" style="border-bottom:3px solid ${s.color}; background:${s.bg};">
                            <div class="sector-title"><i class="ph-fill ${s.icon}" style="color:${s.color};"></i> ${s.name}</div>
                        </div>
                        <div class="sector-body">
                            <div class="top-kpi-grid">
                                <div class="top-kpi-card">
                                    <div class="top-kpi-label">Entregas Totais (No Setor)</div>
                                    <div class="top-kpi-val">${s.count}</div>
                                </div>
                                <div class="top-kpi-card">
                                    <div class="top-kpi-label" style="color:${s.color};">Lead Time Medio Global</div>
                                    <div class="top-kpi-val" style="color:${s.color};">${sectorAvg}</div>
                                </div>
                            </div>
                            <div class="section-title"><i class="ph-fill ph-calendar-blank"></i> Desempenho Mensal (Concluidos)</div>
                            <div class="monthly-scroll">${monthlyHtml}</div>
                            <hr class="report-separator">
                            <div class="section-title"><i class="ph-fill ph-users"></i> Desempenho da Equipe (Lead Time Integral)</div>
                            <div class="gamer-grid">${usersHtml}</div>
                        </div>
                    </div>`;
            });

            container.innerHTML = html;
            if (loading) loading.style.display = 'none';
            if (content) content.style.display = 'flex';
        }
        function updateBulkOptions() { const select = document.getElementById('bulk-stage'); select.innerHTML = '<option value="">Destino em massa...</option>'; configData.workflow.forEach(w => { select.innerHTML += `<option value="${w.name}">${w.name}</option>`; }); }
        function toggleBulkSelection() { const checks = document.querySelectorAll('.bulk-check:checked'); const bar = document.getElementById('bulk-actions-bar'); if (checks.length > 0) { bar.style.display = 'flex'; document.getElementById('bulk-count').innerText = checks.length; } else { bar.style.display = 'none'; } }
        function clearBulkSelection() { document.querySelectorAll('.bulk-check').forEach(c => c.checked = false); toggleBulkSelection(); }
        function openUserModal(u) { const m=document.getElementById('userModal'); m.style.display='flex'; if(u){const d=usersData.find(x=>x.user===u);document.getElementById('u-name').value=d.user;document.getElementById('u-pass').value=d.pass;document.getElementById('u-role').value=d.role;document.getElementById('u-original').value=d.user;} else{document.getElementById('u-name').value='';document.getElementById('u-pass').value='';document.getElementById('u-role').value='comercial';document.getElementById('u-original').value='';} }
        
        function setFilter(v) { const s=document.getElementById('filter-status'); const opts=Array.from(s.options).map(x=>x.value); if(opts.includes(v)) s.value=v; renderOrders(); }
        function renderConfigTable() { const b=document.getElementById('config-body'); b.innerHTML=''; configData.workflow.forEach((s,i)=>{b.innerHTML+=`<tr><td align="center">${i+1}</td><td><input class="config-input" style="margin:0;" value="${s.name}" onchange="updStep(${i},'name',this.value)"></td><td><select class="config-input" style="margin:0;" onchange="updStep(${i},'role',this.value)"><option value="comercial" ${s.role==='comercial'?'selected':''}>Comercial</option><option value="pcp" ${s.role==='pcp'?'selected':''}>PCP</option><option value="layout" ${s.role==='layout'?'selected':''}>Layout</option><option value="producao" ${s.role==='producao'?'selected':''}>Produção</option><option value="faturamento" ${s.role==='faturamento'?'selected':''}>Faturamento</option><option value="admin" ${s.role==='admin'?'selected':''}>Admin/Fim</option></select></td><td><input type="number" class="config-input" style="margin:0;" value="${s.sla}" onchange="updStep(${i},'sla',this.value)"></td><td align="center"><input type="checkbox" style="transform:scale(1.3);" ${s.canReturn?'checked':''} onchange="updStep(${i},'canReturn',this.checked)"></td><td><button class="btn btn-danger btn-icon-only" onclick="rmStep(${i})"><i class="ph-bold ph-trash"></i></button></td></tr>`;}); }
        function addStep() { configData.workflow.push({name:'Nova Etapa', role:'admin', sla:24, canReturn:true}); renderConfigTable(); }
        function rmStep(i) { Swal.fire({title:'Remover etapa?', icon:'warning', showCancelButton: true}).then(r=>{if(r.isConfirmed){configData.workflow.splice(i,1); renderConfigTable();}}) }
        function updStep(i,f,v) { configData.workflow[i][f]=v; }
        function updateFilterOptions() { const s=document.getElementById('filter-status'); s.innerHTML='<option value="all">Todos</option><option value="late">Atrasados</option>'; configData.workflow.forEach(x=>s.innerHTML+=`<option value="${x.name}">${x.name}</option>`); }
        
        function escapeAdminHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, ch => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[ch]));
        }

        function formatUserName(name) {
            return String(name || '')
                .trim()
                .toLowerCase()
                .split(/\s+/)
                .filter(Boolean)
                .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                .join(' ');
        }

        function formatUserRole(role) {
            const key = getSafeStatus(role).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const labels = {
                admin: 'Administrador',
                comercial: 'Comercial',
                faturamento: 'Faturamento',
                layout: 'Layout',
                pcp: 'PCP',
                producao: 'Produ&ccedil;&atilde;o',
                diretoria: 'Diretoria',
                tv: 'TV Monitor'
            };
            return labels[key] || escapeAdminHtml(formatUserName(role));
        }

        async function loadUsers() { 
            try {
                const data = await apiFetch('/usuarios'); 
                usersData = data.map(u => ({ user: u.USERNAME || u.username, pass: u.PASSWORD || u.password, role: u.ROLE || u.role })); 
                const usersHeader = document.querySelector('#view-users .config-table thead tr');
                if (usersHeader) {
                    usersHeader.innerHTML = '<th>Utilizador</th><th>Palavra-passe</th><th>Permiss&atilde;o</th><th style="width: 100px;">A&ccedil;&otilde;es</th>';
                }
                document.getElementById('users-body').innerHTML = usersData.map((u, i)=>{
                    const rawUser = String(u.user || '');
                    const safeUser = escapeAdminHtml(rawUser);
                    const safePass = escapeAdminHtml(u.pass || '');
                    const userArg = escapeAdminHtml(JSON.stringify(rawUser));
                    const displayUser = escapeAdminHtml(formatUserName(rawUser));
                    const displayRole = formatUserRole(u.role);
                    const deleteButton = getSafeStatus(rawUser) !== 'admin'
                        ? `<button class="btn btn-danger btn-icon-only" onclick="deleteUser(${userArg})" title="Excluir utilizador"><i class="ph-bold ph-trash"></i></button>`
                        : '';

                    return `<tr>
                        <td class="user-name-cell">${displayUser || safeUser}</td>
                        <td>
                            <div class="user-password-cell">
                                <span id="pass-${i}" data-pass="${safePass}">••••••••</span>
                                <button class="user-password-toggle" onclick="togglePassword(${i})" title="Mostrar palavra-passe"><i id="icon-${i}" class="ph-bold ph-eye"></i></button>
                            </div>
                        </td>
                        <td><span class="status-badge badge-active user-role-badge">${displayRole}</span></td>
                        <td>
                            <div class="user-actions-cell">
                                <button class="btn btn-secondary btn-icon-only" onclick="openUserModal(${userArg})" title="Editar utilizador"><i class="ph-bold ph-pencil-simple"></i></button>
                                ${deleteButton}
                            </div>
                        </td>
                    </tr>`;
                }).join(''); 
            } catch(e) { console.error("Erro ao carregar usuários", e); }
        }
        
        function togglePassword(index) {
            const span = document.getElementById('pass-' + index);
            const icon = document.getElementById('icon-' + index);
            if (span && icon) {
                if (span.innerText === '••••••••') {
                    span.innerText = span.getAttribute('data-pass');
                    icon.className = 'ph-bold ph-eye-slash';
                } else {
                    span.innerText = '••••••••';
                    icon.className = 'ph-bold ph-eye';
                }
            }
        }
        
        async function saveUser() { 
            const originalUser = document.getElementById('u-original').value; 
            const newUser = document.getElementById('u-name').value.trim(); 
            const newPass = document.getElementById('u-pass').value.trim(); 
            const newRole = document.getElementById('u-role').value; 
            if (!newUser || !newPass) return Swal.fire('Aviso', 'Preencha login e palavra-passe.', 'warning'); 
            
            try { 
                if (originalUser && originalUser !== newUser) { 
                    await apiFetch(`/usuarios/${originalUser}`, 'DELETE'); 
                } 
                await apiFetch('/usuarios', 'POST', { username: newUser, password: newPass, role: newRole }); 
                
                Swal.fire({toast:true, position:'top-end', icon:'success', title:'Guardado!', showConfirmButton:false, timer:2000}); 
                document.getElementById('userModal').style.display='none'; 
                loadUsers(); 
            } catch (e) { Swal.fire('Erro', "Erro ao guardar: " + e.message, 'error'); } 
        }
        
        async function deleteUser(u) { 
            Swal.fire({title:'Excluir utilizador?', icon:'warning', showCancelButton:true}).then(async r => {
                if(r.isConfirmed) { 
                    try {
                        await apiFetch(`/usuarios/${u}`, 'DELETE'); 
                        loadUsers(); 
                    } catch(e) { Swal.fire('Erro', e.message, 'error'); }
                }
            }); 
        }
        
        async function saveConfig() { 
            try {
                await apiFetch('/config/workflow', 'POST', { dados: configData.workflow }); 
                await apiFetch('/config/motivos', 'POST', { dados: configData.movementReasons });
                Swal.fire({title:'Guardado', text:'Configurações aplicadas!', icon:'success'}); 
            } catch (e) { Swal.fire('Erro ao Guardar', 'Motivo: ' + (e.message || e), 'error'); }
        }

        async function abrirPreview(pedidoId) {
            const modal = document.getElementById('filesModal');
            const listContainer = document.getElementById('files-list-container');
            const iframe = document.getElementById('files-preview-iframe');
            const placeholder = document.getElementById('files-preview-placeholder');

            document.getElementById('files-order-id').innerText = pedidoId;
            listContainer.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--cor-texto-mutado);"><i class="ph ph-spinner ph-spin" style="font-size: 2rem; margin-bottom: 10px;"></i><br>A procurar...</div>';
            iframe.style.display = 'none'; iframe.src = '';
            placeholder.style.display = 'block';
            modal.style.display = 'flex';

            try {
                const arquivos = await SinalizaCore.fetchFilesFromVPN(pedidoId);

                if (!arquivos || arquivos.length === 0) {
                    listContainer.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--cor-texto-mutado);"><i class="ph-fill ph-ghost" style="font-size: 2.5rem; margin-bottom:10px;"></i><br>Nenhum arquivo encontrado.</div>';
                    return;
                }

                listContainer.innerHTML = arquivos.map((arq) => {
                    let icon = 'ph-file';
                    if(arq.ext === 'pdf') icon = 'ph-file-pdf';
                    else if(arq.ext === 'html') icon = 'ph-file-code';
                    else if(['jpg','jpeg','png','gif'].includes(arq.ext)) icon = 'ph-file-image';

                    const folderClass = arq.folder.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    const fullUrl = `${SinalizaCore.VPN_URL}${arq.url}`;

                    return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; cursor: pointer; border-bottom: 1px solid var(--cor-borda); background: var(--cor-card-bg); border-radius: 6px; margin-bottom: 6px;" onclick="selecionarArquivoVisor(this, '${fullUrl}')">
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600; overflow: hidden;">
                            <i class="ph-fill ${icon}" style="font-size: 1.2rem; color:var(--cor-primaria)"></i>
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;" title="${arq.name}">${arq.name}</span>
                        </div>
                        <span style="font-size: 0.65rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--cor-borda);">${arq.folder}</span>
                    </div>`;
                }).join('');

            } catch (e) {
                listContainer.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--cor-erro);"><i class="ph-fill ph-warning" style="font-size: 2.5rem; margin-bottom:10px;"></i><br>Falha com o servidor local.</div>';
            }
        }

        function selecionarArquivoVisor(elementoHtml, url) {
            const iframe = document.getElementById('files-preview-iframe');
            const placeholder = document.getElementById('files-preview-placeholder');
            placeholder.style.display = 'none';
            iframe.style.display = 'block';
            iframe.src = url;
        }

        function openChangePassModal() {
            document.getElementById('cp-old').value = '';
            document.getElementById('cp-new').value = '';
            document.getElementById('cp-confirm').value = '';
            document.getElementById('changePassModal').style.display = 'flex';
        }

        async function submitChangePass() {
            const oldPass = document.getElementById('cp-old').value;
            const newPass = document.getElementById('cp-new').value;
            const confirmPass = document.getElementById('cp-confirm').value;

            if (!oldPass || !newPass || !confirmPass) return Swal.fire('Aviso', 'Preencha todos os campos.', 'warning');
            if (newPass !== confirmPass) return Swal.fire('Erro', 'As senhas não coincidem.', 'error');

            const btn = document.getElementById('btn-submit-cp');
            const originalTxt = btn.innerHTML;
            btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Alterando...';
            btn.disabled = true;

            try {
                const res = await fetch(`${API_URL}/change-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: currentUser, oldPassword: oldPass, newPassword: newPass })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Erro ao alterar.');

                document.getElementById('changePassModal').style.display = 'none';
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: data.message, showConfirmButton: false, timer: 3000 });
            } catch(err) {
                Swal.fire('Falha', err.message, 'error');
            } finally {
                btn.innerHTML = originalTxt; btn.disabled = false;
            }
        }

        function normalizeBottleneckText(value) {
            return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        }

        function escapeBottleneckHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        }

        function addBottleneckCounter(map, key, amount = 1) {
            const label = key || 'Nao identificado';
            map[label] = (map[label] || 0) + amount;
        }

        function isBottleneckErrorLog(log) {
            const text = normalizeBottleneckText(`${log.action || ''} ${log.obs || ''}`);
            return text.includes('devolucao') || text.includes('retorno') || text.includes('reprov') || text.includes('problema') || text.includes('erro') || text.includes('prazo estendido') || text.includes('justificativa');
        }

        function getBottleneckReason(log) {
            const obs = String(log.obs || '').trim();
            const action = String(log.action || '').trim();
            const match = obs.match(/\[?Motivo:\s*([^\]\n.]+)/i);
            if (match && match[1]) return match[1].trim();
            if (obs) return obs.replace(/\[|\]/g, '').trim().slice(0, 90);
            return action || 'Ocorrencia sem motivo';
        }

        function getBottleneckSectorByReason(reason) {
            const text = normalizeBottleneckText(reason);
            if (!text) return null;

            if (
                text.includes('aproveitamento') ||
                text.includes('layout') ||
                text.includes('arte') ||
                text.includes('medida') ||
                text.includes('dimens') ||
                text.includes('arquivo') ||
                text.includes('logo') ||
                text.includes('cor errada') ||
                text.includes('fonte') ||
                text.includes('texto') ||
                text.includes('escala')
            ) return 'layout';

            if (text.includes('pcp') || text.includes('liberacao') || text.includes('libera')) return 'pcp';
            if (text.includes('produc') || text.includes('fabrica') || text.includes('maquina') || text.includes('material') || text.includes('acabamento')) return 'producao';
            if (text.includes('fatur') || text.includes('nota') || text.includes('emissao') || text.includes('financeiro')) return 'faturamento';
            if (text.includes('comercial') || text.includes('cliente') || text.includes('orcamento') || text.includes('pedido')) return 'comercial';
            return null;
        }

        function getBottleneckSectorByStatus(status, stages) {
            const safe = normalizeBottleneckText(status);
            const inList = list => list.some(item => normalizeBottleneckText(item) === safe);
            if (inList(stages.layStages) || safe.includes('layout') || safe.includes('arte')) return 'layout';
            if (inList(stages.pcpStages) || safe.includes('pcp') || safe.includes('libera')) return 'pcp';
            if (inList(stages.prodStages) || safe.includes('produc') || safe.includes('fabrica') || safe.includes('maquina') || safe.includes('bancada')) return 'producao';
            if (inList(stages.fatStages) || safe.includes('fatur') || safe.includes('nota') || safe.includes('emissao')) return 'faturamento';
            if (safe.includes('comercial') || safe.includes('cliente')) return 'comercial';
            return 'outros';
        }

        function getBottleneckSectorFromLog(log, currentStatus, stages) {
            const text = normalizeBottleneckText(`${log.action || ''} ${log.from || ''} ${log.to || ''}`);
            if (text.includes('layout') || text.includes('arte') || text.includes('cliente apro') || text.includes('cliente reprov')) return 'layout';
            if (text.includes('pcp') || text.includes('libera')) return 'pcp';
            if (text.includes('produc') || text.includes('fabrica') || text.includes('maquina') || text.includes('bancada') || text.includes('expedicao')) return 'producao';
            if (text.includes('fatur') || text.includes('nota') || text.includes('emissao')) return 'faturamento';
            if (text.includes('comercial') || text.includes('cliente')) return 'comercial';
            return getBottleneckSectorByStatus(currentStatus || log.from || log.to, stages);
        }

        function getBottleneckUserRoleSector(name) {
            const safeName = normalizeBottleneckText(name);
            if (!safeName || !Array.isArray(usersData)) return null;

            const user = usersData.find(u => normalizeBottleneckText(u.user) === safeName);
            const role = normalizeBottleneckText(user?.role);
            if (role.includes('layout')) return 'layout';
            if (role.includes('pcp')) return 'pcp';
            if (role.includes('produc')) return 'producao';
            if (role.includes('fatur')) return 'faturamento';
            if (role.includes('comercial')) return 'comercial';
            return null;
        }

        function getBottleneckStatusBeforeLog(logs, index) {
            const log = logs[index] || {};
            if (log.from) return getSafeStatus(log.from);
            for (let i = index - 1; i >= 0; i--) {
                if (logs[i]?.to) return getSafeStatus(logs[i].to);
            }
            return getSafeStatus(log.to);
        }

        function getBottleneckTimelineSector(logs, index, stages) {
            const log = logs[index] || {};
            const statusBefore = getBottleneckStatusBeforeLog(logs, index);
            const statusSector = getBottleneckSectorByStatus(statusBefore, stages);
            if (statusSector !== 'outros') return statusSector;
            return getBottleneckSectorFromLog(log, statusBefore || log.from || log.to, stages);
        }

        function getBottleneckPreviousSender(logs, errorIndex, responsibleSector, detectorSector, stages) {
            let sectorCandidate = null;
            let roleCandidate = null;

            for (let i = errorIndex - 1; i >= 0; i--) {
                const prev = logs[i];
                const user = normalizarNome(prev.user);
                if (!user || user === 'Sistema') continue;

                const prevFromSector = getBottleneckSectorByStatus(prev.from, stages);
                const prevToSector = getBottleneckSectorByStatus(prev.to, stages);
                const timelineSector = getBottleneckTimelineSector(logs, i, stages);
                const roleSector = getBottleneckUserRoleSector(user);
                const cameFromResponsible = prevFromSector === responsibleSector || timelineSector === responsibleSector || roleSector === responsibleSector;
                const sentToDetector = detectorSector && detectorSector !== 'outros' && prevToSector === detectorSector;
                const movedOutOfResponsible = timelineSector === responsibleSector && prevToSector !== responsibleSector && prevToSector !== 'outros';

                if ((sentToDetector && cameFromResponsible) || movedOutOfResponsible) {
                    return user;
                }

                if (!sectorCandidate && timelineSector === responsibleSector) {
                    sectorCandidate = user;
                }

                if (!roleCandidate && roleSector === responsibleSector) {
                    roleCandidate = user;
                }
            }
            return sectorCandidate || roleCandidate || null;
        }

        function resolveBottleneckResponsibility(log, logs, errorIndex, currentStatus, stages) {
            const reason = getBottleneckReason(log);
            const logSector = getBottleneckSectorFromLog(log, currentStatus, stages);
            const detectorSector = getBottleneckSectorByStatus(log.from || currentStatus, stages);
            const returnedToSector = getBottleneckSectorByStatus(log.to, stages);
            const text = normalizeBottleneckText(`${log.action || ''} ${log.obs || ''}`);
            const isReturn = text.includes('devolucao') || text.includes('retorno') || text.includes('reprov');

            let responsibleSector = getBottleneckSectorByReason(reason);
            if (!responsibleSector && isReturn && returnedToSector !== 'outros') responsibleSector = returnedToSector;
            if (!responsibleSector) responsibleSector = logSector;

            const pointedBy = normalizarNome(log.user) || 'Sistema';
            const previousSender = getBottleneckPreviousSender(logs, errorIndex, responsibleSector, detectorSector, stages);
            const responsibleUser = previousSender || pointedBy;

            return {
                reason,
                responsibleSector,
                responsibleUser,
                pointedBy,
                detectorSector: detectorSector !== 'outros' ? detectorSector : logSector
            };
        }

        function getBottleneckUserStats(name, stats) {
            const userName = normalizarNome(name) || 'Sistema';
            if (!stats[userName]) stats[userName] = { name: userName, touchedOrders: new Set(), errorOrders: new Set(), errors: 0, sectors: {}, reasons: {} };
            if (!stats[userName].errorOrders) stats[userName].errorOrders = new Set();
            return stats[userName];
        }

        function renderBottleneckInsights(sectorStats, userStats, sectorMeta, totalOccurrences) {
            const sectorRows = Object.entries(sectorStats).filter(([, stats]) => stats.errors > 0).sort((a, b) => b[1].errors - a[1].errors);
            const maxSectorErrors = Math.max(1, ...sectorRows.map(([, stats]) => stats.errors));
            const sectorsHtml = sectorRows.length ? sectorRows.map(([key, stats]) => {
                const meta = sectorMeta[key];
                const topReason = Object.entries(stats.reasons).sort((a, b) => b[1] - a[1])[0];
                const pct = Math.round((stats.errors / maxSectorErrors) * 100);
                return `
                    <div class="bottleneck-sector-card">
                        <div class="bottleneck-sector-head">
                            <i class="${meta.icon}" style="color:${meta.color};"></i>
                            <div><strong>${meta.label}</strong><span>${stats.orders.size} pedido(s) afetado(s)</span></div>
                            <b>${stats.errors}</b>
                        </div>
                        <div class="bottleneck-bar"><span style="width:${pct}%; background:${meta.color};"></span></div>
                        <small>${topReason ? `${escapeBottleneckHtml(topReason[0])} (${topReason[1]}x)` : 'Sem motivo identificado'}</small>
                    </div>
                `;
            }).join('') : '<div class="bottleneck-empty">Nenhuma ocorrencia encontrada nos pedidos concluidos.</div>';

            const users = Object.values(userStats)
                .filter(u => u.name !== 'Sistema' && u.errors > 0)
                .map(u => ({ ...u, totalOrders: (u.errorOrders || new Set()).size }))
                .sort((a, b) => b.errors - a.errors || b.totalOrders - a.totalOrders)
                .slice(0, 8);
            const maxUserErrors = Math.max(1, ...users.map(u => u.errors));
            const usersHtml = users.length ? users.map((u, index) => {
                const topReason = Object.entries(u.reasons).sort((a, b) => b[1] - a[1])[0];
                const width = Math.max(6, Math.round((u.errors / maxUserErrors) * 100));
                return `
                    <div class="bottleneck-person-row">
                        <div class="bottleneck-rank">${index + 1}</div>
                        <div class="bottleneck-person-main">
                            <strong>${escapeBottleneckHtml(u.name)}</strong>
                            <span>${u.totalOrders} pedido(s) com erro atribuido</span>
                            <div class="bottleneck-rate"><span style="width:${width}%;"></span></div>
                            <small>${topReason ? `Motivo principal: ${escapeBottleneckHtml(topReason[0])}` : 'Sem erro atribuido'}</small>
                        </div>
                        <b>${u.errors}</b>
                    </div>
                `;
            }).join('') : '<div class="bottleneck-empty">Ainda nao ha responsaveis suficientes para montar ranking de erros.</div>';

            const reasonRows = sectorRows.flatMap(([key, stats]) => Object.entries(stats.reasons).map(([reason, count]) => ({ reason, count, sector: sectorMeta[key].label, color: sectorMeta[key].color }))).sort((a, b) => b.count - a.count).slice(0, 6);
            const reasonsHtml = reasonRows.length ? reasonRows.map(item => `
                <div class="bottleneck-reason-chip">
                    <span style="background:${item.color};"></span>
                    <strong>${escapeBottleneckHtml(item.reason)}</strong>
                    <small>${item.sector} - ${item.count}x</small>
                </div>
            `).join('') : '<div class="bottleneck-empty">Sem motivos registrados.</div>';

            return `
                <section class="bottleneck-panel bottleneck-panel-wide">
                    <div class="bottleneck-panel-title"><i class="ph-fill ph-flow-arrow"></i><span>Gargalos por setor</span><b>${totalOccurrences} ocorrencia(s)</b></div>
                    <div class="bottleneck-sector-grid">${sectorsHtml}</div>
                </section>
                <section class="bottleneck-panel">
                    <div class="bottleneck-panel-title"><i class="ph-fill ph-users-three"></i><span>Erros por responsavel</span></div>
                    <div class="bottleneck-person-list">${usersHtml}</div>
                </section>
                <section class="bottleneck-panel">
                    <div class="bottleneck-panel-title"><i class="ph-fill ph-list-magnifying-glass"></i><span>Motivos mais comuns</span></div>
                    <div class="bottleneck-reason-list">${reasonsHtml}</div>
                </section>
            `;
        }

        function processAdminBottlenecks() {
            const kpiContainer = document.getElementById('gargalos-kpi-container');
            const listContainer = document.getElementById('gargalos-orders-list');
            const insightsContainer = document.getElementById('gargalos-insights');
            if (!kpiContainer || !listContainer) return;

            if (!configData.workflow || configData.workflow.length === 0) {
                kpiContainer.innerHTML = '';
                if (insightsContainer) insightsContainer.innerHTML = '';
                listContainer.innerHTML = '<div style="text-align:center; padding:50px; color:var(--cor-texto-mutado);">Aguardando configuracoes de workflow.</div>';
                return;
            }

            const stages = getAdminBottleneckStages();
            adminBottleneckData = [];
            const sectorMeta = {
                layout: { label: 'Layout', icon: 'ph-fill ph-paint-brush', color: 'var(--cor-primaria)' },
                pcp: { label: 'PCP', icon: 'ph-fill ph-clipboard-text', color: 'var(--cor-alerta)' },
                producao: { label: 'Fabrica', icon: 'ph-fill ph-hammer', color: 'var(--cor-info)' },
                faturamento: { label: 'Faturamento', icon: 'ph-fill ph-receipt', color: 'var(--cor-sucesso)' },
                comercial: { label: 'Comercial', icon: 'ph-fill ph-briefcase', color: 'var(--cor-retorno)' },
                outros: { label: 'Outros', icon: 'ph-fill ph-dots-three-outline', color: 'var(--cor-texto-mutado)' }
            };
            const sectorStats = Object.fromEntries(Object.keys(sectorMeta).map(key => [key, { errors: 0, orders: new Set(), reasons: {}, authors: {} }]));
            const userStats = {};
            let totalLay = 0, countLay = 0, totalPcp = 0, countPcp = 0, totalProd = 0, countProd = 0, totalFat = 0, countFat = 0, totalOccurrences = 0;

            ordersData.forEach(o => {
                const logs = (o.history || []).filter(h => h && h.date && !isNaN(new Date(h.date).getTime())).sort((a, b) => new Date(a.date) - new Date(b.date));
                let currentOrderStatus = getSafeStatus(o.status);
                if (logs.length > 0 && logs[logs.length - 1].to) currentOrderStatus = getSafeStatus(logs[logs.length - 1].to);
                const isFat = stages.fatStages.includes(currentOrderStatus) || currentOrderStatus.includes('faturam') || currentOrderStatus.includes('nota');
                const isFinal = currentOrderStatus === stages.finalStage || currentOrderStatus.includes('finalizad') || currentOrderStatus.includes('concluid') || currentOrderStatus.includes('entregue') || logs.some(h => String(h.action || '').toLowerCase().includes('nota emitida'));
                if (!isFat && !isFinal) return;

                const finishedDate = logs.length > 0 ? new Date(logs[logs.length - 1].date) : new Date(o.created_at || o.issue_date || Date.now());
                let lastDate = new Date(o.created_at || o.issue_date || o.delivery || finishedDate);
                if (isNaN(lastDate.getTime()) && logs.length > 0) lastDate = new Date(logs[0].date);
                let currentStatus = logs.length > 0 ? getSafeStatus(logs[0].from || logs[0].to) : getSafeStatus(o.status);
                const row = { id: o.id, client: o.client || '-', timeLay: 0, timePcp: 0, timeProd: 0, timeFat: 0, usersLay: new Set(), usersPcp: new Set(), usersProd: new Set(), usersFat: new Set(), errors: [], finishedDate };

                logs.forEach((log, logIndex) => {
                    const logDate = new Date(log.date);
                    if (isNaN(logDate.getTime()) || logDate < lastDate) return;
                    const mins = diffMinsCalcAdmin(lastDate, logDate);
                    if (mins > 0 && mins < 43200) {
                        const statusSector = getBottleneckSectorByStatus(currentStatus, stages);
                        if (statusSector === 'layout') row.timeLay += mins;
                        else if (statusSector === 'producao') row.timeProd += mins;
                        else if (statusSector === 'pcp') row.timePcp += mins;
                        else if (statusSector === 'faturamento') row.timeFat += mins;
                    }

                    const user = normalizarNome(log.user);
                    const logSector = getBottleneckSectorFromLog(log, currentStatus, stages);
                    if (user && user !== 'Sistema') {
                        const person = getBottleneckUserStats(user, userStats);
                        person.touchedOrders.add(String(o.id));
                        addBottleneckCounter(person.sectors, sectorMeta[logSector]?.label || 'Outros');
                        if (logSector === 'layout') row.usersLay.add(user);
                        else if (logSector === 'pcp') row.usersPcp.add(user);
                        else if (logSector === 'producao') row.usersProd.add(user);
                        else if (logSector === 'faturamento') row.usersFat.add(user);
                    }

                    if (isBottleneckErrorLog(log)) {
                        const responsibility = resolveBottleneckResponsibility(log, logs, logIndex, currentStatus, stages);
                        const reason = responsibility.reason;
                        const author = responsibility.responsibleUser || user || 'Sistema';
                        const sector = sectorStats[responsibility.responsibleSector] ? responsibility.responsibleSector : 'outros';
                        const detectorSector = sectorStats[responsibility.detectorSector] ? responsibility.detectorSector : logSector;
                        row.errors.push({
                            date: logDate,
                            action: log.action || 'Ocorrencia',
                            user: author,
                            obs: reason,
                            sector: sectorMeta[sector].label,
                            pointedBy: responsibility.pointedBy,
                            detectedSector: sectorMeta[detectorSector]?.label || 'Outros'
                        });
                        totalOccurrences++;
                        sectorStats[sector].errors++;
                        sectorStats[sector].orders.add(String(o.id));
                        addBottleneckCounter(sectorStats[sector].reasons, reason);
                        addBottleneckCounter(sectorStats[sector].authors, author);
                        const person = getBottleneckUserStats(author, userStats);
                        person.errors++;
                        person.errorOrders.add(String(o.id));
                        person.touchedOrders.add(String(o.id));
                        addBottleneckCounter(person.reasons, reason);
                        addBottleneckCounter(person.sectors, sectorMeta[sector].label);
                    }

                    const logTo = getSafeStatus(log.to);
                    if (logTo) currentStatus = logTo;
                    lastDate = logDate;
                });

                const finalMins = diffMinsCalcAdmin(lastDate, row.finishedDate);
                if (finalMins > 0 && finalMins < 43200) {
                    const statusSector = getBottleneckSectorByStatus(currentStatus, stages);
                    if (statusSector === 'layout') row.timeLay += finalMins;
                    else if (statusSector === 'producao') row.timeProd += finalMins;
                    else if (statusSector === 'pcp') row.timePcp += finalMins;
                    else if (statusSector === 'faturamento') row.timeFat += finalMins;
                }
                if (row.timeLay > 0) { totalLay += row.timeLay; countLay++; }
                if (row.timePcp > 0) { totalPcp += row.timePcp; countPcp++; }
                if (row.timeProd > 0) { totalProd += row.timeProd; countProd++; }
                if (row.timeFat > 0) { totalFat += row.timeFat; countFat++; }
                row.usersLay = Array.from(row.usersLay).join(', ');
                row.usersPcp = Array.from(row.usersPcp).join(', ');
                row.usersProd = Array.from(row.usersProd).join(', ');
                row.usersFat = Array.from(row.usersFat).join(', ');
                adminBottleneckData.push(row);
            });

            adminBottleneckData.sort((a, b) => b.finishedDate - a.finishedDate);
            kpiContainer.innerHTML = `
                ${createKPI('Layout', formatAvgTime(countLay > 0 ? totalLay / countLay : 0), 'ph-fill ph-paint-brush', 'var(--cor-primaria-soft-bg)', 'var(--cor-primaria)')}
                ${createKPI('PCP', formatAvgTime(countPcp > 0 ? totalPcp / countPcp : 0), 'ph-fill ph-clipboard-text', 'var(--warning-bg)', 'var(--cor-alerta)')}
                ${createKPI('Fabrica', formatAvgTime(countProd > 0 ? totalProd / countProd : 0), 'ph-fill ph-hammer', 'var(--info-bg)', 'var(--cor-info)')}
                ${createKPI('Ocorrencias', totalOccurrences, 'ph-fill ph-warning-octagon', 'var(--danger-bg)', 'var(--cor-erro)')}
            `;
            if (insightsContainer) insightsContainer.innerHTML = renderBottleneckInsights(sectorStats, userStats, sectorMeta, totalOccurrences);
            renderAdminBottleneckList();
        }

        function renderAdminBottleneckList() {
            const container = document.getElementById('gargalos-orders-list');
            if (!container) return;
            const searchEl = document.getElementById('gargalos-search-input');
            const filterEl = document.getElementById('gargalos-filter-errors');
            const search = searchEl ? normalizeBottleneckText(searchEl.value) : '';
            const filter = filterEl ? filterEl.value : 'all';
            let filtered = adminBottleneckData;
            if (filter === 'errors_only') filtered = filtered.filter(o => o.errors.length > 0);
            if (search) filtered = filtered.filter(o => normalizeBottleneckText(o.id).includes(search) || normalizeBottleneckText(o.client).includes(search));
            if (filtered.length === 0) {
                container.innerHTML = '<div style="text-align:center; padding:50px; color:var(--cor-texto-mutado);">Nenhum gargalo encontrado para estes filtros.</div>';
                return;
            }
            container.innerHTML = filtered.map(o => {
                const totalMins = o.timeLay + o.timePcp + o.timeProd + o.timeFat;
                const hasErrors = o.errors.length > 0;
                const rowId = getAdminDomId(o.id);
                const firstError = hasErrors ? o.errors[0] : null;
                const errorsHtml = hasErrors ? `
                    <div class="admin-error-block">
                        <div class="admin-error-title"><i class="ph-fill ph-warning-octagon"></i> Motivos e autores dos erros</div>
                        ${o.errors.map(e => `
                            <div class="admin-error-item visual-error-item">
                                <div><strong>${escapeBottleneckHtml(e.action)}</strong><span>${escapeBottleneckHtml(e.obs || 'Sem observacao registrada.')}</span></div>
                                <small><i class="ph-bold ph-user"></i> Responsavel: ${escapeBottleneckHtml(e.user)} - ${escapeBottleneckHtml(e.sector)}${e.pointedBy && e.pointedBy !== e.user ? ` | Apontado por: ${escapeBottleneckHtml(e.pointedBy)} - ${escapeBottleneckHtml(e.detectedSector || 'N/D')}` : ''} - ${e.date.toLocaleString('pt-BR')}</small>
                            </div>
                        `).join('')}
                    </div>
                ` : '';
                return `
                    <div class="list-row admin-bottleneck-row ${hasErrors ? 'has-error' : 'no-error'}" id="gargalo-row-${rowId}">
                        <div class="row-header">
                            <div class="col-info">
                                <span class="row-id">#${escapeBottleneckHtml(o.id)}</span>
                                <div class="row-client">${escapeBottleneckHtml(o.client)}</div>
                                <div class="info-praz"><i class="ph-bold ph-check-circle"></i> Concluido em ${o.finishedDate.toLocaleDateString('pt-BR')}</div>
                            </div>
                            <div class="admin-bottleneck-summary">
                                <span><i class="ph-bold ph-clock"></i> Lead time: ${formatLeadTimeAdmin(totalMins)}</span>
                                ${hasErrors ? `<span class="is-danger"><i class="ph-bold ph-warning-octagon"></i> ${o.errors.length} erro(s)</span>` : '<span><i class="ph-bold ph-check-circle"></i> Sem erros</span>'}
                                ${firstError ? `<span class="is-danger"><i class="ph-bold ph-user"></i> ${escapeBottleneckHtml(firstError.user)}</span>` : ''}
                            </div>
                            <div class="col-actions">
                                <button class="btn btn-secondary" type="button" onclick="toggleAdminBottleneckCard('${rowId}')"><i class="ph-bold ph-magnifying-glass"></i> Ver caso <i class="ph-bold ph-caret-down"></i></button>
                            </div>
                        </div>
                        <div class="card-details" onclick="event.stopPropagation()">
                            <div class="admin-sector-timeline">
                                <div class="admin-sector-step sector-layout"><strong>Layout</strong><span>${formatLeadTimeAdmin(o.timeLay)}</span><small>${escapeBottleneckHtml(o.usersLay || 'N/D')}</small></div>
                                <div class="admin-sector-step sector-pcp"><strong>PCP</strong><span>${formatLeadTimeAdmin(o.timePcp)}</span><small>${escapeBottleneckHtml(o.usersPcp || 'N/D')}</small></div>
                                <div class="admin-sector-step sector-producao"><strong>Fabrica</strong><span>${formatLeadTimeAdmin(o.timeProd)}</span><small>${escapeBottleneckHtml(o.usersProd || 'N/D')}</small></div>
                                <div class="admin-sector-step sector-fat"><strong>Emissao</strong><span>${formatLeadTimeAdmin(o.timeFat)}</span><small>${escapeBottleneckHtml(o.usersFat || 'N/D')}</small></div>
                            </div>
                            ${errorsHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }
