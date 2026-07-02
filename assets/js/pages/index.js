

/* =========================================================
   Correção visual: libera os cards do login
   O CSS usa body.ui-ready para executar animações e remover opacity:0.
   ========================================================= */
window.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('ui-ready');
});

const API_URL = '/api';

const roleToPageMap = {
    'admin': 'admin.html',
    'comercial': 'comercial.html',
    'layout': 'layout.html',
    'pcp': 'pcp.html',
    'producao': 'producao.html',
    'faturamento': 'faturamento.html',
    'tv': 'tv.html',
    'diretoria': 'diretoria.html'
};

const roleToLabelMap = {
    'admin': 'Administração',
    'comercial': 'Comercial',
    'layout': 'Layout',
    'pcp': 'PCP',
    'producao': 'Produção',
    'faturamento': 'Faturamento',
    'tv': 'TV Operacional',
    'diretoria': 'Diretoria'
};

function showLoginLoading(message = 'Preparando sua área de trabalho...') {
    const overlay = document.getElementById('loginLoadingOverlay');
    const messageEl = document.getElementById('login-loading-message');

    if (messageEl) messageEl.textContent = message;
    if (overlay) {
        overlay.classList.add('is-active');
        overlay.setAttribute('aria-hidden', 'false');
    }
}

function hideLoginLoading() {
    const overlay = document.getElementById('loginLoadingOverlay');

    if (overlay) {
        overlay.classList.remove('is-active');
        overlay.setAttribute('aria-hidden', 'true');
    }
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function prewarmDestination(destinationPage) {
    try {
        // Pré-carrega o HTML da próxima página sem depender de iframe.
        await fetch(destinationPage, {
            credentials: 'same-origin',
            cache: 'force-cache'
        }).catch(() => null);
    } catch (error) {
        console.warn('Pré-carregamento ignorado:', error);
    }
}

async function goToDestinationWithLoading(destinationPage, role, username) {
    const label = roleToLabelMap[role] || 'Sistema';

    showLoginLoading(`Carregando ${label} para ${username || 'usuário'}...`);

    await Promise.allSettled([
        wait(950),
        prewarmDestination(destinationPage)
    ]);

    window.location.href = destinationPage;
}

async function handleLogin(event) {
    event.preventDefault();

    const userIn = document.getElementById('username').value.trim();
    const passIn = document.getElementById('password').value.trim();
    const btn = document.getElementById('btn-submit');

    if (!userIn || !passIn) return;

    btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Validando acesso...';
    btn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/usuarios`);
        if (!response.ok) throw new Error("Falha na conexão com o Oracle Cloud.");
        const users = await response.json();

        const foundUser = users.find(u => {
            const dbUser = String(u.USERNAME || u.username || '').toLowerCase();
            const dbPass = String(u.PASSWORD || u.password || '');
            return dbUser === userIn.toLowerCase() && dbPass === passIn;
        });

        if (foundUser) {
            const role = String(foundUser.ROLE || foundUser.role || '').toLowerCase();
            const username = foundUser.USERNAME || foundUser.username;

            const sessionData = {
                username: username,
                role: role,
                timestamp: new Date().getTime()
            };

            localStorage.setItem('sinaliza_sessao', JSON.stringify(sessionData));

            const destinationPage = roleToPageMap[role] || 'index.html';

            btn.innerHTML = '<i class="ph-bold ph-check-circle"></i> Acesso liberado';

            await goToDestinationWithLoading(destinationPage, role, username);

        } else {
            Swal.fire({
                title: 'Acesso Negado',
                text: 'O utilizador ou a palavra-passe estão incorretos.',
                icon: 'error',
                confirmButtonColor: 'var(--cor-primaria)',
                confirmButtonText: 'Tentar Novamente',
                customClass: { popup: 'swal2-rounded' }
            });
            resetBtn(btn);
        }
    } catch (error) {
        console.error("Erro no login:", error);
        hideLoginLoading();

        Swal.fire({
            title: 'Falha de Conexão',
            text: 'Não foi possível conectar ao banco de dados Oracle. Verifique se o servidor Node.js está em execução.',
            icon: 'warning',
            confirmButtonColor: 'var(--cor-primaria)'
        });

        resetBtn(btn);
    }
}

function resetBtn(btn) {
    btn.innerHTML = 'Entrar no Sistema <i class="ph-bold ph-arrow-right"></i>';
    btn.disabled = false;
}

function openForgotModal(e) {
    e.preventDefault();
    document.getElementById('forgot-email').value = '';
    document.getElementById('forgotModal').style.display = 'flex';
}

async function submitForgotPassword() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return Swal.fire('Aviso', 'Preencha o e-mail.', 'warning');

    const btn = document.getElementById('btn-submit-forgot');
    const originalTxt = btn.innerHTML;
    btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> A enviar...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'Erro ao processar pedido.');

        document.getElementById('forgotModal').style.display = 'none';
        Swal.fire('Verifique o E-mail', data.message, 'success');
    } catch(err) {
        Swal.fire('Falha', err.message, 'error');
    } finally {
        btn.innerHTML = originalTxt;
        btn.disabled = false;
    }
}

async function submitResetPassword() {
    const token = document.getElementById('reset-token').value;
    const newPass = document.getElementById('reset-new-pass').value;
    const confirmPass = document.getElementById('reset-confirm-pass').value;

    if (!newPass || !confirmPass) return Swal.fire('Aviso', 'Preencha todos os campos.', 'warning');
    if (newPass !== confirmPass) return Swal.fire('Aviso', 'As palavras-passe não coincidem.', 'warning');

    const btn = document.getElementById('btn-submit-reset');
    const originalTxt = btn.innerHTML;
    btn.innerHTML = '<i class="ph-bold ph-spinner ph-spin"></i> Atualizando...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword: newPass })
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'Erro ao atualizar.');

        document.getElementById('resetModal').style.display = 'none';
        Swal.fire('Sucesso!', 'A sua palavra-passe foi alterada. Já pode iniciar sessão.', 'success').then(() => {
            window.location.href = 'index.html';
        });
    } catch(err) {
        Swal.fire('Falha', err.message, 'error');
    } finally {
        btn.innerHTML = originalTxt;
        btn.disabled = false;
    }
}

// Auto-Login e Token Check
window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
        document.getElementById('reset-token').value = token;
        document.getElementById('resetModal').style.display = 'flex';
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
    }

    const sessao = localStorage.getItem('sinaliza_sessao');
    if (sessao) {
        try {
            const data = JSON.parse(sessao);
            if (data && data.role && roleToPageMap[data.role]) {
                goToDestinationWithLoading(roleToPageMap[data.role], data.role, data.username || 'usuário');
            }
        } catch(e) {
            localStorage.removeItem('sinaliza_sessao');
        }
    }
};
