function showMessage(text, kind) {
    const el = document.getElementById('message');
    el.textContent = text;
    el.className = 'message ' + (kind || 'error');
    el.style.display = 'block';
}

function hideMessage() {
    document.getElementById('message').style.display = 'none';
}

function showForm(id) {
    hideMessage();
    document.querySelectorAll('form').forEach(f => f.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

async function postJSON(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { ok: res.ok, data };
}

document.addEventListener('DOMContentLoaded', async () => {
    // Already signed in? Go straight to admin.
    try {
        const me = await fetch('/api/auth/me');
        if (me.ok) { location.href = '/adminjd'; return; }
    } catch (e) { /* ignore */ }

    const params = new URLSearchParams(location.search);
    const errors = {
        not_invited: 'This account is not invited. Ask an existing admin for an invitation.',
        oauth_failed: 'Google sign-in failed. Please try again.',
        google_not_configured: 'Google sign-in is not configured on this server.'
    };
    if (params.get('error')) showMessage(errors[params.get('error')] || 'Sign-in failed.');

    document.getElementById('show-register').onclick = () => showForm('register-form');
    document.getElementById('show-forgot').onclick = () => showForm('forgot-form');
    document.querySelectorAll('.show-login').forEach(a => a.onclick = () => showForm('login-form'));

    document.getElementById('login-form').onsubmit = async (e) => {
        e.preventDefault();
        const { ok, data } = await postJSON('/api/auth/login', {
            email: document.getElementById('login-email').value,
            password: document.getElementById('login-password').value
        });
        if (ok) location.href = '/adminjd';
        else showMessage(data.error || 'Sign-in failed.');
    };

    document.getElementById('register-form').onsubmit = async (e) => {
        e.preventDefault();
        const { ok, data } = await postJSON('/api/auth/register', {
            email: document.getElementById('register-email').value,
            password: document.getElementById('register-password').value
        });
        if (ok) location.href = '/adminjd';
        else showMessage(data.error || 'Registration failed.');
    };

    document.getElementById('forgot-form').onsubmit = async (e) => {
        e.preventDefault();
        const { ok, data } = await postJSON('/api/auth/forgot', {
            email: document.getElementById('forgot-email').value
        });
        if (ok) showMessage(data.message, 'info');
        else showMessage(data.error || 'Request failed.');
    };
});
