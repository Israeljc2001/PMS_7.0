/**
 * SINALIZA CORE ENGINE
 * Motor Central de Regras de Negócio, Prazos (SLA), VPN e Timestamps (BI)
 */

const SinalizaCore = {
    VPN_URL: 'http://192.168.2.48:3001',

    // 1. Sincronização e Busca de Arquivos
    triggerVPNSync: async function() {
        return fetch(`${this.VPN_URL}/api/sync`, { method: 'POST' });
    },

    fetchFilesFromVPN: async function(id) {
        const res = await fetch(`${this.VPN_URL}/api/pedidos/${id}/files`);
        if (!res.ok) throw new Error('Falha ao conectar na VPN do Agente.');
        return res.json();
    },

    // 2. Motor Inteligente de SLA (Prazos)
    calculateSLA: function(order, extensions = []) {
        let baseDate = order.data_entrega_layout || order.delivery;
        
        if (!baseDate) {
            baseDate = order.issue_date || (order.created_at ? order.created_at.split('T')[0] : null);
            if (!baseDate) return { dateStr: '9999-12-31', displayDate: '--/--', status: 'normal', diffDays: 999 };
        }

        let d;
        
        // --- 🚀 NOVO PARSER BLINDADO PARA FORMATOS DO ORACLE E ERPS ---
        const dataStr = String(baseDate).trim();

        // 1. Formato Oracle Nativo: DD-MON-YY (ex: 23-MAR-26)
        if (/^\d{2}-[A-Za-z]{3}-\d{2}$/i.test(dataStr)) {
            const monthMap = { 
                'jan':'01', 'feb':'02', 'fev':'02', 'mar':'03', 'apr':'04', 'abr':'04', 
                'may':'05', 'mai':'05', 'jun':'06', 'jul':'07', 'aug':'08', 'ago':'08', 
                'sep':'09', 'set':'09', 'oct':'10', 'out':'10', 'nov':'11', 'dec':'12', 'dez':'12' 
            };
            const parts = dataStr.split('-');
            const day = parts[0].padStart(2, '0');
            const month = monthMap[parts[1].toLowerCase()] || '01';
            // Assume século 21 para o ano
            const year = (parseInt(parts[2]) < 50 ? '20' : '19') + parts[2];
            d = new Date(`${year}-${month}-${day}T12:00:00`);
        } 
        // 2. Formato Português/Brasileiro: DD/MM/YYYY (ex: 16/03/2026)
        else if (/^\d{2}\/\d{2}\/\d{4}/.test(dataStr)) {
            const parts = dataStr.substring(0, 10).split('/');
            d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
        }
        // 3. Formato ISO com Tempo: YYYY-MM-DDTHH:MM:SSZ
        else if (dataStr.includes('T')) {
            d = new Date(dataStr);
        } 
        // 4. Formato Universal Padrão: YYYY-MM-DD (ex: 2026-03-23)
        else if (/^\d{4}-\d{2}-\d{2}/.test(dataStr)) {
            d = new Date(dataStr.substring(0, 10) + 'T12:00:00');
        } 
        // 5. Fallback de Emergência
        else {
            d = new Date(dataStr);
        }

        // Se após tudo isso a data for inválida, devolve N/D
        if (isNaN(d.getTime())) {
            return { dateStr: '9999-12-31', displayDate: 'N/D', status: 'normal', diffDays: 999 };
        }
        
        // Soma todos os dias de prazo extra pedidos por qualquer setor
        let totalExt = 0;
        if (extensions && extensions.length > 0) {
            extensions.forEach(ext => { totalExt += parseInt(ext.days || 0); });
        }
        d.setDate(d.getDate() + totalExt);

        const finalDateStr = d.toISOString().split('T')[0];
        const displayDate = finalDateStr.split('-').reverse().join('/');

        // Verificação de Atraso real vs Data Atual
        const todayStr = new Date().toISOString().split('T')[0];
        const todayObj = new Date(todayStr + 'T12:00:00');
        const diffDays = Math.round((d - todayObj) / (1000 * 60 * 60 * 24));

        let status = 'normal';
        if (diffDays < 0) status = 'late';
        else if (diffDays <= 2) status = 'warning';

        return { dateStr: finalDateStr, displayDate, status, diffDays };
    },

    // 3. Utilitários de Fluxo de Trabalho
    getPrevStep: function(currentStatus, workflow) {
        const idx = workflow.findIndex(s => s.name === currentStatus);
        if (idx > 0) return workflow[idx - 1].name;
        return null;
    },

    getNextStep: function(currentStatus, workflow) {
        const idx = workflow.findIndex(s => s.name === currentStatus);
        if (idx !== -1 && idx < workflow.length - 1) return workflow[idx + 1].name;
        return 'Finalizado';
    },

    // 4. Construtor de Histórico Textual
    buildHistoryEntry: function(action, to, user, reason = '', obs = '') {
        let text = '';
        if (reason && !reason.includes('Normal')) {
            text += `[Motivo: ${reason}] `;
        }
        if (obs) text += obs;
        
        return {
            date: new Date().toISOString(),
            action: action,
            to: to,
            user: user || 'Sistema',
            obs: text.trim()
        };
    },

    // 5. 🚀 Relógio Suíço (Timestamps Dinâmicos para BI)
    gerarTimestamps: function(statusAtual, novoStatus) {
        const mapaSetores = {
            'Comercial': 'comercial',
            'Em Layout': 'layout',
            'PCP Revisão': 'pcp',
            'Em Produção': 'producao',
            'Em Faturamento': 'faturamento'
        };

        const setorAtual = mapaSetores[statusAtual];
        const setorNovo = mapaSetores[novoStatus];
        
        const payload = {};
        const agora = new Date().toISOString();

        if (setorAtual) payload[`conclusao_${setorAtual}`] = agora;
        if (setorNovo) payload[`entrada_${setorNovo}`] = agora;

        return payload;
    }
};