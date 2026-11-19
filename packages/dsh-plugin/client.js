window.__ModuleLoader__.load({
  id: 'dsh-agentcode-live',
  factory(require) {
    const { createElement: h } = require('react');
    const namespace = 'agentcodeLiveFiles';
    const locales = {
      en: {
        tab: 'File activity', empty: 'File-tool changes will appear here.',
        source: 'Changes reported by DeepSeek Harness file tools',
        created: 'Created', modified: 'Modified', patched: 'Patched',
      },
      zh: {
        tab: '文件活动', empty: '文件工具产生的变更会显示在这里。',
        source: 'DeepSeek Harness 文件工具报告的变更',
        created: '新建', modified: '修改', patched: '应用补丁',
      },
    };

    function FileActivity({ useProjection, t }) {
      const events = useProjection(namespace);
      return h('section', {
        'aria-label': t('tab'),
        style: { maxWidth: '780px', width: '100%', margin: '0 auto', padding: '24px', overflow: 'auto' },
      },
      h('p', { style: { opacity: 0.7, marginBottom: '16px' } }, t('source')),
      events?.length ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
        events.map(event => h('li', {
          key: event.id,
          style: { display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid color-mix(in srgb, currentColor 15%, transparent)' },
        },
        h('span', { style: { minWidth: '88px' } }, t(event.operation)),
        h('code', { style: { overflowWrap: 'anywhere', flex: 1 } }, event.path),
        h('time', { style: { opacity: 0.7 } }, new Date(event.time).toLocaleTimeString()))))
        : h('p', null, t('empty')));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(namespace, locales), 'AgentCode Live dictionaries');
        const t = ctx.locale.bind(namespace);
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'agentcode-live-files', order: 90,
          locale: namespace, label: () => t('tab'),
        }, FileActivity));
      },
    };
  },
});
