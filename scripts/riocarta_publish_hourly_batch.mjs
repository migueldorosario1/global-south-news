import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const repo = process.cwd();
const queuePath = path.join(repo, 'tools', 'riocarta_hourly_queue.json');
const statePath = path.join(repo, 'tools', 'riocarta_hourly_state.json');
const logPath = path.join(repo, 'logs', 'rio_carta_publication_audit.jsonl');
const reportPath = path.join(repo, 'logs', 'rio_carta_relatorio_bloqueios.md');
const brainPath = path.join(repo, '..', 'CEREBRO_INDEX_RIOCARTA.md');
const blogDir = path.join(repo, 'src', 'content', 'blog');
const publicDir = path.join(repo, 'public');
const pausePath = path.join(repo, 'tools', 'riocarta_publish_paused.txt');

const args = new Set(process.argv.slice(2));
const envPath = path.join(repo, '..', 'root', 'chaves_riocarta.env');
const forcedBatchSize = process.env.RIOCARTA_BATCH_SIZE ? Number(process.env.RIOCARTA_BATCH_SIZE) : null;
const forcedMaxAuditAttempts = process.env.RIOCARTA_MAX_AUDIT_ATTEMPTS ? Number(process.env.RIOCARTA_MAX_AUDIT_ATTEMPTS) : null;
const forcedMaxBatchSize = process.env.RIOCARTA_MAX_BATCH_SIZE ? Number(process.env.RIOCARTA_MAX_BATCH_SIZE) : null;
const defaultBatchSize = 10;
const auditCurrentOnly = args.has('--audit-current');
const commitAndPush = args.has('--commit') && !auditCurrentOnly;
const skipGitPush = args.has('--no-push');
const deployVercel = args.has('--vercel-deploy');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
let state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { nextBatchSize: defaultBatchSize, round: 1 };

if (fs.existsSync(pausePath) && !auditCurrentOnly) {
  const reason = fs.readFileSync(pausePath, 'utf8').replace(/\s+/g, ' ').trim().slice(0, 240);
  console.log(`Publicacao automatica Rio Carta pausada: ${reason}`);
  process.exit(0);
}

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

function parseTags(frontmatter) {
  const raw = getField(frontmatter, 'tags');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((tag) => String(tag));
  } catch {}
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((tag) => tag.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function primaryCategoryFromTags(tags) {
  const priority = [
    'politica-rj',
    'seguranca-publica',
    'transporte-mobilidade',
    'transporte-e-mobilidade-rj',
    'saude',
    'educacao',
    'cultura-carnaval',
    'baixada-fluminense',
    'regiao-dos-lagos',
    'norte-noroeste-fluminense',
    'sul-fluminense',
    'regiao-serrana',
    'rio-favelas-e-comunidades',
    'nacional',
    'internacional',
    'geopolitica',
  ];
  return priority.find((tag) => tags.includes(tag)) || tags[0] || 'sem-categoria';
}

function orderHiddenByDiversity(files) {
  const buckets = new Map();
  for (const file of files) {
    try {
      const text = fs.readFileSync(path.join(blogDir, file), 'utf8');
      const { frontmatter } = splitFrontmatter(text);
      const category = primaryCategoryFromTags(parseTags(frontmatter));
      if (!buckets.has(category)) buckets.set(category, []);
      buckets.get(category).push(file);
    } catch {
      if (!buckets.has('erro-leitura')) buckets.set('erro-leitura', []);
      buckets.get('erro-leitura').push(file);
    }
  }

  const ordered = [];
  while ([...buckets.values()].some((items) => items.length)) {
    for (const items of buckets.values()) {
      if (items.length) ordered.push(items.shift());
    }
  }
  return ordered;
}

function setDraft(frontmatter, draft) {
  if (frontmatter.match(/^draft:\s*(true|false)\s*$/m)) {
    return frontmatter.replace(/^draft:\s*(true|false)\s*$/m, `draft: ${draft ? 'true' : 'false'}`);
  }
  return `${frontmatter}\ndraft: ${draft ? 'true' : 'false'}`;
}

const KNOWN_SOURCE_NAMES = {
  'diariodorio.com': 'Diário do Rio',
  'portalfluminense.com.br': 'Portal Fluminense',
  'sfnoticias.com.br': 'SF Notícias',
  'agenciabrasil.ebc.com.br': 'Agência Brasil',
  'g1.globo.com': 'g1',
  'extra.globo.com': 'Extra',
  'oglobo.globo.com': 'O Globo',
  'ofluminense.com.br': 'O Fluminense',
  'conexaofluminense.com.br': 'Conexao Fluminense',
  'brasildefatorj.com.br': 'Brasil de Fato RJ',
  'tupi.fm': 'Super Rádio Tupi',
  'agendadopoder.com.br': 'Agenda do Poder',
  'cliquediario.com.br': 'Clique Diário',
};

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isKnownHost(url) {
  const h = hostnameFromUrl(url);
  return h !== null && Object.prototype.hasOwnProperty.call(KNOWN_SOURCE_NAMES, h);
}

function sourceNameFromUrl(url) {
  const hostname = hostnameFromUrl(url);
  if (!hostname) return 'fonte original';
  return KNOWN_SOURCE_NAMES[hostname] || hostname.split('.')[0].replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanSourceName(name, url) {
  // Blacklist: nomes placeholder ou proibidos (diretrizes editoriais Rio Carta).
  // Sempre derivam do URL via sourceNameFromUrl. Fix BUG-20260513-SARMAT §51.
  const cleaned = String(name || '')
    .replace(/^publica[cç][aã]o original$/i, '')
    .replace(/^fonte original$/i, '')
    .replace(/^ag[êe]ncia internacional$/i, '')
    .trim();
  return cleaned || sourceNameFromUrl(url);
}

function normalizeSourceCredits(body) {
  return body
    .replace(/\*Fonte para revisão: \[([^\]]+)\]\(([^)]+)\)\.\*/g, (_match, name, url) => `*Fonte: [${cleanSourceName(name, url)}](${url}).*`)
    .replace(/\*Fonte: \[([^\]]+)\]\(([^)]+)\)\.\*/gi, (_match, name, url) => {
      // Se hostname está no mapa explícito, SEMPRE sobrepõe nome existente (mesmo se for "Agência Internacional" ou similar errado herdado do coletor).
      if (isKnownHost(url)) {
        return `*Fonte: [${sourceNameFromUrl(url)}](${url}).*`;
      }
      // Senão, só limpa "publicação original" / "fonte original" preservando outros nomes.
      return `*Fonte: [${cleanSourceName(name, url)}](${url}).*`;
    });
}

function splitSentences(paragraph) {
  const sentences = paragraph
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+(?:[.!?]+["”’']?|$)/g);
  return sentences?.map((item) => item.trim()).filter(Boolean) || [paragraph.trim()];
}

function shortParagraphs(body) {
  return body
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (
        trimmed.startsWith('*Fonte:') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('>') ||
        trimmed.startsWith('- ') ||
        trimmed.includes('<') ||
        trimmed.includes('```')
      ) {
        return trimmed;
      }
      const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const paragraphs = [];
      for (const line of lines) {
        const sentences = splitSentences(line);
        for (let index = 0; index < sentences.length; index += 2) {
          paragraphs.push(sentences.slice(index, index + 2).join(' '));
        }
      }
      return paragraphs.join('\n\n');
    })
    .join('\n\n');
}

function cleanBody(body) {
  const cleaned = body
    .replace(/^> Rascunho técnico de smoke\. Revisar edição, categoria e imagem antes de publicar\.\n\n/m, '')
    .replace(/^Compartilhe:\s*$/gim, '')
    .trim();
  return `${shortParagraphs(normalizeSourceCredits(cleaned)).trimEnd()}\n`;
}

function brainNotes() {
  const notes = [];
  const brain = fs.existsSync(brainPath) ? fs.readFileSync(brainPath, 'utf8') : '';
  if (brain.includes('Media DB') || brain.includes('mídia')) {
    notes.push('imagens devem ficar dentro do silo Rio Carta antes do deploy');
  }
  if (brain.includes('Markdown') || brain.includes('Astro')) {
    notes.push('publicação correta é Markdown/Astro/Vercel, não WordPress');
  }
  notes.push('falha editorial crítica deve segurar a publicação, corrigir e tentar novamente');
  return notes;
}

function summarizeReason(reason) {
  if (!reason) return 'sem motivo registrado';
  return reason
    .replace(/auditoria ampliada sem mais de 3 votos [^:]+:\s*/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 420);
}

function readAuditEvents() {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function writeHourlyReport(extra = {}) {
  const events = readAuditEvents();
  const blocked = events.filter((event) => event.blocked);
  const latest = new Map();
  for (const event of blocked) latest.set(event.file, event);
  const published = events.filter((event) => event.published);
  const notes = brainNotes();
  const lines = [
    '# Rio Carta - Relatorio horario de bloqueios',
    '',
    `Atualizado em: ${new Date().toISOString()}`,
    `Publicadas/auditadas com sucesso no historico: ${published.length}`,
    `Materias com bloqueio acumulado: ${latest.size}`,
    '',
    '## Solucoes do cerebro aplicadas',
    ...notes.map((note) => `- ${note}`),
    '',
    '## Bloqueios acumulados',
  ];
  if (latest.size === 0) {
    lines.push('- Nenhum bloqueio acumulado ate agora.');
  } else {
    for (const event of latest.values()) {
      lines.push(`- ${event.file}: ${summarizeReason(event.reason)}`);
    }
  }
  if (extra.published?.length) {
    lines.push('', '## Publicadas nesta rodada', ...extra.published.map((file) => `- ${file}`));
  }
  if (extra.retained?.length) {
    lines.push('', '## Retidas nesta rodada', ...extra.retained.map((item) => `- ${item.file}: ${summarizeReason(item.reason)}`));
  }
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);
}

async function applyBrainFixes(file, context = {}) {
  const fullPath = path.join(blogDir, file);
  let text = fs.readFileSync(fullPath, 'utf8');
  const { frontmatter, body } = splitFrontmatter(text);
  const heroImage = getField(frontmatter, 'heroImage');
  const heroPath = path.join(publicDir, heroImage.replace(/^\//, ''));
  const applied = [];

  const cleanedBody = cleanBody(body)
    .replace(/\ncontinua após as imagens\n/gi, '\n')
    .replace(/\nVeja o vídeo abaixo[^\n]*\n/gi, '\n');
  if (cleanedBody !== body) {
    text = `---\n${frontmatter}\n---\n${cleanedBody}`;
    fs.writeFileSync(fullPath, text);
    applied.push('limpeza de marcas internas/fonte conforme padrao Markdown Rio Carta');
  }

  if (fs.existsSync(heroPath)) {
    const meta = await sharp(heroPath).metadata();
    if ((meta.width || 0) < 600 || (meta.height || 0) < 315) {
      await sharp(heroPath)
        .resize({ width: Math.max(1200, meta.width || 1200), withoutEnlargement: false })
        .toFile(`${heroPath}.tmp`);
      fs.renameSync(`${heroPath}.tmp`, heroPath);
      applied.push('imagem destacada ampliada dentro do silo Rio Carta');
    }
  }

  if (context.reason) {
    fs.appendFileSync(logPath, `${JSON.stringify({
      time: new Date().toISOString(),
      file,
      brainFixAttempt: true,
      applied,
      previousReason: summarizeReason(context.reason),
    })}\n`);
  }
  return applied;
}

async function askModelAuditor(auditor, article) {
  if (!auditor.key) return { auditor: auditor.name, ok: null, reason: 'chave ausente' };
  const prompt = [
    'Audite esta materia antes de publicacao no Rio Carta.',
    'Responda somente JSON: {"ok":true|false,"reason":"curto","fix":"curto"}.',
    'Critérios: fato plausivel, titulo honesto, categoria territorial coerente, imagem destacada aceitavel, sem aviso interno de rascunho.',
    'Data atual para auditoria: 2026-05-13 BRT. Datas de 2025 ja sao passado.',
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
  if (!fs.existsSync(fullPath)) {
    fs.appendFileSync(logPath, `${JSON.stringify({
      time: new Date().toISOString(),
      file,
      published: false,
      blocked: true,
      reason: 'arquivo da fila ausente; item ignorado para nao derrubar o publicador remoto',
    })}\n`);
    continue;
  }
  const text = fs.readFileSync(fullPath, 'utf8');
  if (text.match(/^draft:\s*false\s*$/m)) visible.push(file);
  else hidden.push(file);
}

const requestedBatchSize = forcedBatchSize || state.nextBatchSize || defaultBatchSize;
const maxBatchSize = forcedMaxBatchSize || defaultBatchSize;
const batchSize = auditCurrentOnly ? 0 : Math.min(requestedBatchSize, maxBatchSize);
const maxAuditAttempts = Math.max(batchSize, forcedMaxAuditAttempts || batchSize * 3);
let nextBatch = [];
if (!auditCurrentOnly && hidden.length === 0) {
  console.log('Fila encerrada: nenhuma materia pendente.');
  process.exit(0);
}

const results = [];
for (const file of visible) {
  try {
    results.push(await auditAndFix(file, true));
  } catch (error) {
    // Fix Claude 2026-05-13 16:50 BRT (autorização Miguel "recomendo a, vamos corrigir logo"):
    // Matéria já-publicada perdeu consenso na re-auditoria. Antes: throw fatal parava
    // TODO o batch. Agora: rebaixa pra draft (esconde do público), loga e CONTINUA.
    const reason = String(error.message || error);
    fs.appendFileSync(logPath, `${JSON.stringify({
      time: new Date().toISOString(),
      file,
      published: false,
      rebaixada_por_reaudit: true,
      reason: `re-auditoria de visible perdeu consenso: ${reason.slice(0, 320)}`,
    })}\n`);
    try {
      // publish=false faz setDraft(true) → matéria some do público até revisão humana.
      results.push(await auditAndFix(file, false));
      console.log(`Rebaixada por re-auditoria: ${file} — ${reason.slice(0, 220)}`);
    } catch (innerError) {
      console.log(`Erro ao rebaixar ${file}: ${String(innerError.message || innerError).slice(0, 220)}`);
    }
  }
}

if (auditCurrentOnly) {
  for (const file of orderHiddenByDiversity(hidden)) {
    results.push(await auditAndFix(file, false));
  }
} else {
  let attemptedHidden = 0;
  for (const file of hidden) {
    if (nextBatch.length >= batchSize) {
      results.push(await auditAndFix(file, false));
      continue;
    }
    if (attemptedHidden >= maxAuditAttempts) {
      fs.appendFileSync(logPath, `${JSON.stringify({
        time: new Date().toISOString(),
        published: false,
        blocked: true,
        reason: `limite de auditoria da rodada atingido (${attemptedHidden}/${maxAuditAttempts}); aguardando proximo ciclo`,
      })}\n`);
      break;
    }
    attemptedHidden += 1;
    try {
      await applyBrainFixes(file);
      results.push(await auditAndFix(file, true));
      nextBatch.push(file);
    } catch (error) {
      const firstReason = String(error.message || error);
      const applied = await applyBrainFixes(file, { reason: firstReason });
      if (applied.length) {
        try {
          results.push(await auditAndFix(file, true));
          nextBatch.push(file);
          continue;
        } catch (retryError) {
          error = retryError;
        }
      }
      fs.appendFileSync(logPath, `${JSON.stringify({
        time: new Date().toISOString(),
        file,
        published: false,
        blocked: true,
        reason: String(error.message || error),
      })}\n`);
      try {
        results.push(await auditAndFix(file, false));
      } catch {}
      console.log(`Retida pela auditoria: ${file} — ${String(error.message || error).slice(0, 220)}`);
    }
  }
  if (nextBatch.length === 0) {
    console.log('Nenhuma materia nova passou na auditoria deste ciclo.');
  }
}

const changedArticleSet = auditCurrentOnly
  ? [...new Set([...visible, ...hidden])]
  : [...new Set([...visible, ...nextBatch])];
const publishSet = auditCurrentOnly ? visible : nextBatch;

execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' });

if (!auditCurrentOnly) {
  state = {
    round: (state.round || 1) + 1,
    nextBatchSize: defaultBatchSize,
    lastBatchSize: nextBatch.length,
    lastRun: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

writeHourlyReport({ published: publishSet });

if (commitAndPush) {
  const heroImages = changedArticleSet
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
    'logs/rio_carta_relatorio_bloqueios.md',
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
    ...changedArticleSet.map((file) => `src/content/blog/${file}`),
    ...heroImages,
  ];
  git(['add', ...changedFiles]);
  const staged = git(['diff', '--cached', '--name-only']);
  if (staged) {
    const publishedTitles = publishSet.map((file) => path.basename(file, '.md')).join(', ');
    git(['commit', '-m', `Publish Rio Carta hourly batch (${publishSet.length})`, '-m', publishedTitles]);
    if (!skipGitPush) {
      git(['push', 'origin', 'main']);
    }
    if (publishSet.length) {
      execFileSync(
        process.env.RIOCARTA_PYTHON || 'python3',
        [path.join(repo, '..', 'root', 'riocarta_confirm_published.py'), ...publishSet],
        { cwd: repo, stdio: 'inherit' },
      );
    }
  }
}

if (deployVercel && !auditCurrentOnly) {
  execFileSync('npx', ['vercel', 'deploy', '--prod', '--yes'], { cwd: repo, stdio: 'inherit' });
}

console.log(`${auditCurrentOnly ? 'Auditado neste ciclo' : 'Publicado neste ciclo'}: ${publishSet.join(', ')}`);
for (const result of results.filter((item) => item.warnings.length)) {
  console.log(`Aviso ${result.file}: ${result.warnings.join('; ')}`);
}
