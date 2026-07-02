        // 🔒 TRAVA DE SEGURANÇA E ROLE-CHECK
        const sessaoString = localStorage.getItem('sinaliza_sessao');
        let currentUser = null; let currentRole = null;

        if (!sessaoString) {
            window.location.href = 'index.html';
        } else {
            try {
                const sessaoData = JSON.parse(sessaoString);
                currentUser = sessaoData.username; currentRole = sessaoData.role;
                if (currentRole !== 'layout' && currentRole !== 'admin') {
                    window.location.href = 'index.html';
                }
            } catch(e) { window.location.href = 'index.html'; }
        }