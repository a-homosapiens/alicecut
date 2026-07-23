const version = new URLSearchParams(window.location.hash.slice(1)).get('version')
document.getElementById('app-version').textContent = version ? `v${version}` : ''
