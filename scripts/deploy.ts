/**
 * Build the static site and publish it to the `gh-pages` branch on origin.
 * GitHub Pages serves that branch at https://<user>.github.io/<repo>/.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, mkdirSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

function run(cmd: string, args: string[], cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status) process.exit(r.status ?? 1)
}

function capture(cmd: string, args: string[], cwd = ROOT) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status) return ''
  return (r.stdout ?? '').trim()
}

const remote = capture('git', ['remote', 'get-url', 'origin'])
if (!remote) {
  console.error('No `origin` remote. Create the GitHub repo first (gh repo create), then re-run npm run deploy.')
  process.exit(1)
}

console.log('Building…')
run('npm', ['run', 'build'])
if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('Build did not produce dist/index.html')
  process.exit(1)
}

const work = path.join(tmpdir(), `wpgg-pages-${Date.now()}`)
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', 'gh-pages', remote, work], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
if (clone.status) {
  run('git', ['init', '-b', 'gh-pages'], work)
  run('git', ['remote', 'add', 'origin', remote], work)
} else {
  // Empty the published tree except .git so deleted files do not linger.
  for (const name of ['node_modules']) {
    void name
  }
  run('git', ['rm', '-rf', '--ignore-unmatch', '.'], work)
}

cpSync(DIST, work, { recursive: true })
writeFileSync(path.join(work, '.nojekyll'), '')

run('git', ['add', '-A'], work)
const dirty = capture('git', ['status', '--porcelain'], work)
if (!dirty) {
  console.log('Site is already up to date.')
  rmSync(work, { recursive: true, force: true })
  process.exit(0)
}

const sha = capture('git', ['rev-parse', '--short', 'HEAD']) || 'local'
run('git', ['-c', 'user.name=wpgg-deploy', '-c', 'user.email=deploy@localhost', 'commit', '-m', `Update site from ${sha}`], work)
run('git', ['push', '-u', 'origin', 'HEAD:gh-pages'], work)
rmSync(work, { recursive: true, force: true })

const repo = capture('gh', ['repo', 'view', '--json', 'nameWithOwner,url', '-q', '.nameWithOwner'])
const pages = repo ? `https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/` : ''
console.log(pages ? `Published ${pages}` : 'Published gh-pages. Enable GitHub Pages on the gh-pages branch if this is the first deploy.')
