// 校验产物中的署名与版权信息
const asar = require('@electron/asar');
const p = process.argv[2];

const list = asar.listPackage(p);
const read = (suffix) => {
  const want = suffix.replace(/\\/g, '/');
  const hit = list.find((x) => x.replace(/\\/g, '/').endsWith(want));
  if (!hit) return '';
  return asar.extractFile(p, hit.replace(/^[\\/]/, '')).toString();
};

const app = read('src/js/app.js');
const lic = read('LICENSE');
const readme = read('README.md');
const pkg = read('package.json');

const checks = [
  ['关于页署名「Create BY BennerRock」', app.includes('Create BY BennerRock')],
  ['LICENSE 头部版权', /HYWmusic Desktop\s*\nCopyright 2026 BennerRock/.test(lic)],
  ['LICENSE 附录版权', lic.includes('Copyright 2026 BennerRock')],
  ['README 版权', readme.includes('Copyright 2026 BennerRock')],
  ['package.json author', /"author":\s*"BennerRock"/.test(pkg)],
  ['无旧署名残留', !app.includes('HYWmusic Team') && !lic.includes('HYWmusic Team')],
];

let bad = 0;
for (const [label, ok] of checks) {
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label);
}
console.log('\n结果：' + (bad ? `不通过（${bad} 项）` : '全部通过 ✓'));
process.exit(bad ? 1 : 0);
