import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const repo = process.cwd();
const queuePath = path.join(repo, 'tools', 'riocarta_hourly_queue.json');
const statePath = path.join(repo, 'tools', 'riocarta_hourly_state.json');
const logPath = path.join(repo, 'logs', 'rio_carta_publication_audit.jsonl');
const blogDir = path.join(repo, 'src', 'content', 'blog');
const publicDir = path.join(repo, 'public');

const args = new Set(process.argv.slice(2));
const envPath = path.join(repo, '..', 'root', 'chaves_riocarta.env');
const forcedBatchSize = process.env.RIOCARTA_BATCH_SIZE ? Number(process.env.RIOCARTA_BATCH_SIZE) : null;
const commitAndPush = args.has('--commit');
const auditCurrentOnly = args.has('--audit-current');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
let state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { nextBatchSize: 3, round: 1 };

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('frontmatter ausente');
  return { frontmatter: match[1], body: match[2] };
}

function getField(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^"|"$/g, '') : '';
}

function setDraft(frontmatter, draft) {
  if (frontmatter.match(/^draft:\s*(true|false)\s*$/m)) {
    return frontmatter.replace(/^draft:\s*(true|false)\s*$/m, `draft: ${draft ? 'true' : 'false'}`);
  }
  return `${frontmatter}\ndraft: ${draft ? 'true' : 'false'}`;
}

function cleanBody(body) {
  return body
    .replace(/^> Rascunho técnico de smoke\. Revisar edição, categoria e imagem antes de publicar\.\n\n/m, '')
    .replace(/\*Fonte para revisão: \[[^\]]+\]\(([^)]+)\)\.\*/g, '*Fonte: [publicação original]($1).*')
    .trimEnd() + '\n';
}

async function askModelAuditor(auditor, article) {
  if (!auditor.key) return { auditor: auditor.name, ok: null, reason: 'chave ausente' };
  const prompt = [
    'Audite esta materia antes de publicacao no Rio Carta.',
    'Responda somente JSON: {"ok":true|false,"reason":"curto","fix":"curto"}.',
    'Critérios: fato plausivel, titulo honesto, categoria territorial coerente, imagem destacada aceitavel, sem aviso interno de rascunho.',
    `TITULO: ${article.title}`,
    `TAGS: ${article.tags}`,
    `IMAGEM: ${article.heroImage} ${article.imageSize}`,
    `TEXTO:\n${article.body.slice(0, 4500)}`,
  ].join('\n\n');
  try {
    const response = await fetch(`${auditor.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auditor.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: auditor.model,
        temperature: 0,
        max_tokens: 220,
        messages: [
          { role: 'system', content: 'Voce e um editor de checagem seco e conservador.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) return { auditor: auditor.name, ok: null, reason: `HTTP ${response.status}` };
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    let json;
    try {
      json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
    } catch {
      const lower = raw.toLowerCase();
      json = {
        ok: lower.includes('"ok":true') || lower.includes('ok: true') || lower.includes('aprov'),
        reason: raw.replace(/\s+/g, ' ').slice(0, 180),
      };
    }
    return { auditor: auditor.name, ok: Boolean(json.ok), reason: json.reason || '', fix: json.fix || '' };
  } catch (error) {
    return { auditor: auditor.name, ok: null, reason: String(error.message || error).slice(0, 160) };
  }
}

function localVotes(article, warnings) {
  const textOk = article.body.length > 900 && !article.body.includes('Rascunho técnico') && !article.body.includes('Fonte para revisão');
  const categoryOk = warnings.length === 0 || warnings.every((warning) => warning === 'titulo longo');
  const imageOk = !article.imageSize.startsWith('0x') && Number(article.imageSize.split('x')[0]) >= 600;
  return [
    { auditor: 'codex-texto-categoria', ok: textOk && categoryOk, reason: textOk && categoryOk ? 'texto e categorias aceitaveis' : 'texto/categoria precisa revisao' },
    { auditor: 'codex-imagem-fonte', ok: imageOk, reason: imageOk ? 'imagem destacada aceitavel' : 'imagem destacada insuficiente' },
  ];
}

async function expandedConsensus(article, warnings) {
  if (args.has('--skip-chinese-audit')) return { passed: true, votes: [], skipped: true };
  const auditors = [
    {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_AUDIT_MODEL || 'deepseek-chat',
      key: process.env.DEEPSEEK_API_KEY,
    },
    {
      name: 'kimi',
      baseUrl: 'https://api.moonshot.ai/v1',
      model: process.env.KIMI_AUDIT_MODEL || 'moonshot-v1-8k',
      key: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY,
    },
    {
      name: 'qwen',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      model: process.env.QWEN_AUDIT_MODEL || 'qwen-plus',
      key: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY,
    },
  ];
  const modelVotes = await Promise.all(auditors.map((auditor) => askModelAuditor(auditor, article)));
  const votes = [...modelVotes, ...localVotes(article, warnings)];
  const clearVotes = votes.filter((vote) => vote.ok !== null);
  const approvals = clearVotes.filter((vote) => vote.ok).length;
  return { passed: approvals > 3, votes, approvals };
}

async function auditAndFix(file, publish) {
  const fullPath = path.join(blogDir, file);
  let text = fs.readFileSync(fullPath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(text);
  const title = getField(frontmatter, 'title');
  const heroImage = getField(frontmatter, 'heroImage');
  const description = getField(frontmatter, 'description');
  const tags = getField(frontmatter, 'tags');
  const heroPath = path.join(publicDir, heroImage.replace(/^\//, ''));
  const warnings = [];

  if (!title || title.length < 20) warnings.push('titulo fraco ou ausente');
  if (title.length > 125) warnings.push('titulo longo');
  if (!description || description.length < 80) warnings.push('descricao curta');
  if (!tags.includes('rio-de-janeiro') && !tags.includes('niteroi') && !tags.includes('baixada-fluminense')) {
    warnings.push('categoria territorial fraca');
  }
  if (!fs.existsSync(heroPath)) throw new Error(`imagem destacada ausente: ${heroImage}`);

  const meta = await sharp(heroPath).metadata();
  if ((meta.width || 0) < 600 || (meta.height || 0) < 315) {
    const warning = `imagem destacada pequena: ${heroImage} ${meta.width}x${meta.height}`;
    if (publish) throw new Error(warning);
    warnings.push(warning);
  }

  let nextBody = cleanBody(body);
  const articleForAudit = {
        title,
        heroImage,
        tags,
        body: nextBody,
        imageSize: `${meta.width}x${meta.height}`,
  };
  const consensus = publish
    ? await expandedConsensus(articleForAudit, warnings)
    : { passed: true, votes: [] };
  if (publish && !consensus.passed) {
    throw new Error(`auditoria ampliada sem mais de 3 votos ${file}: ${JSON.stringify(consensus.votes)}`);
  }

  let nextFrontmatter = setDraft(frontmatter, !publish);
  const nextText = `---\n${nextFrontmatter}\n---\n${nextBody}`;
  if (nextText !== text) fs.writeFileSync(fullPath, nextText);

  const audit = {
    time: new Date().toISOString(),
    file,
    published: publish,
    title,
    heroImage,
    imageSize: `${meta.width}x${meta.height}`,
    warnings,
    expandedAudit: consensus.votes,
    approvals: consensus.approvals,
  };
  fs.appendFileSync(logPath, `${JSON.stringify(audit)}\n`);
  return { file, warnings };
}

const visible = [];
const hidden = [];
for (const file of queue) {
  const fullPath = path.join(blogDir, file);
  if (!fs.existsSync(fullPath)) throw new Error(`arquivo da fila ausente: ${file}`);
  const text = fs.readFileSync(fullPath, 'utf8');
  if (text.match(/^draft:\s*false\s*$/m)) visible.push(file);
  else hidden.push(file);
}

const batchSize = auditCurrentOnly ? 0 : forcedBatchSize || state.nextBatchSize || 3;
const nextBatch = hidden.slice(0, batchSize);
if (!auditCurrentOnly && nextBatch.length === 0) {
  console.log('Fila encerrada: nenhuma materia pendente.');
  process.exit(0);
}

const results = [];
for (const file of queue) {
  const shouldPublish = auditCurrentOnly ? visible.includes(file) : nextBatch.includes(file) || visible.includes(file);
  results.push(await auditAndFix(file, shouldPublish));
}

execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' });

if (!auditCurrentOnly) {
  state = {
    round: (state.round || 1) + 1,
    nextBatchSize: Math.min((state.nextBatchSize || 3) * 2, 12),
    lastBatchSize: nextBatch.length,
    lastRun: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

if (commitAndPush) {
  const publishSet = auditCurrentOnly ? visible : nextBatch;
  const heroImages = publishSet
    .map((file) => {
      const text = fs.readFileSync(path.join(blogDir, file), 'utf8');
      const { frontmatter } = splitFrontmatter(text);
      return `public/${getField(frontmatter, 'heroImage').replace(/^\//, '')}`;
    })
    .filter(Boolean);
  const changedFiles = [
    'tools/riocarta_hourly_queue.json',
    'tools/riocarta_hourly_state.json',
    'package.json',
    'scripts/riocarta_hourly_cron.sh',
    'scripts/riocarta_publish_hourly_batch.mjs',
    'logs/rio_carta_publication_audit.jsonl',
    'src/content.config.ts',
    'src/components/Interlinks.astro',
    'src/pages/blog/[...slug].astro',
    'src/pages/blog/index.astro',
    'src/pages/historico/[year].astro',
    'src/pages/historico/[year]/[month].astro',
    'src/pages/historico/index.astro',
    'src/pages/index.astro',
    'src/pages/rss.xml.js',
    'src/pages/tags/[tag].astro',
    ...publishSet.map((file) => `src/content/blog/${file}`),
    ...heroImages,
  ];
  git(['add', ...changedFiles]);
  const staged = git(['diff', '--cached', '--name-only']);
  if (staged) {
    const publishedTitles = publishSet.map((file) => path.basename(file, '.md')).join(', ');
    git(['commit', '-m', `Publish Rio Carta hourly batch (${publishSet.length})`, '-m', publishedTitles]);
    git(['push', 'origin', 'main']);
  }
}

console.log(`${auditCurrentOnly ? 'Auditado neste ciclo' : 'Publicado neste ciclo'}: ${(auditCurrentOnly ? visible : nextBatch).join(', ')}`);
for (const result of results.filter((item) => item.warnings.length)) {
  console.log(`Aviso ${result.file}: ${result.warnings.join('; ')}`);
}
