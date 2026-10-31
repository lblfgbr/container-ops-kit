// Loaded only by the generated offline demo, after the shared page defines its renderers.
(() => {
  const embedded = applicationEmbeddedContent;
  applicationEmbeddedContent = () => embedded().replace(/<iframe\b[^>]*><\/iframe>/g,
    '<section class="panel" style="padding:40px;text-align:center" aria-label="模拟外部应用"><h2>外部应用演示</h2><p>此处展示应用入口的交互流程。离线演示不会连接外部系统。</p></section>');
})();
