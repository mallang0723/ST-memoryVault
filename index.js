import { getContext } from '../../../st-context.js';
import { isGenerating } from '../../../../script.js';
import { sha256 } from '../../../../lib.js';
import { newWorldInfoEntryTemplate, worldInfoCache, updateWorldInfoList } from '../../../world-info.js';
import { createHost } from './host.js';
import { mountMemoryVault } from './extension.js';

function reportError(error) {
    console.error('[Memory Vault]', error);
    globalThis.toastr?.error(String(error?.message || error), '기억 보관함');
}

try {
    const host = createHost({
        getContext, reportError, isGenerating, hashString: sha256,
        worldInfo: { template: newWorldInfoEntryTemplate, cache: worldInfoCache, updateList: updateWorldInfoList },
    });
    host.start();
    const vault = mountMemoryVault(host);

    function installControls() {
        const settings = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
        if (settings && !document.getElementById('memory-vault-settings')) {
            const section = document.createElement('div');
            section.id = 'memory-vault-settings';
            section.className = 'extension_container';
            section.innerHTML = `<div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header"><b>기억 보관함 · Memory Vault</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
                <div class="inline-drawer-content"><p>현재 채팅의 약속·앵커·요소 기억·이야기 위키를 관리합니다.</p>
                <div class="memory-vault-actions"><button type="button" class="menu_button" data-vault-open>보관함 열기</button>
                <a class="menu_button" href="https://github.com/mallang0723/memoryVaultSilly" target="_blank" rel="noopener noreferrer">소스 · 사용법</a></div>
                <small>설정 → 로어북에서 기억 JSON을 가져오거나 내보낼 수 있습니다. AI 기능은 현재 SillyTavern API 연결을 사용합니다.</small></div></div>`;
            section.querySelector('[data-vault-open]').addEventListener('click', () => void vault.open());
            settings.append(section);
        }
        const menu = document.getElementById('extensionsMenu');
        if (menu && !document.getElementById('memory-vault-menu')) {
            const item = document.createElement('div');
            item.id = 'memory-vault-menu';
            item.className = 'list-group-item flex-container flexGap5';
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.innerHTML = '<i class="fa-solid fa-box-archive"></i><span>기억 보관함</span>';
            item.addEventListener('click', () => void vault.open());
            item.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void vault.open(); }
            });
            menu.append(item);
        }
    }
    installControls();
    const { eventSource, eventTypes } = getContext();
    eventSource.on(eventTypes.APP_READY, installControls);
    window.addEventListener('pagehide', () => {
        eventSource.removeListener(eventTypes.APP_READY, installControls);
        vault.dispose();
        host.dispose();
    }, { once: true });
} catch (error) { reportError(error); }
