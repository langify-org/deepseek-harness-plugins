import { describe, expect, it } from 'vitest'
import { names, naming, noteLines, recall, related, words } from './related.ts'

describe('words', () => {
  it('keeps Latin words whole and pairs the characters of the rest', () => {
    expect(words('kiln の再開は --resume')).toEqual(['kiln', 'の再', '再開', '開は', 'resume'])
  })
})

describe('recall', () => {
  const lines = noteLines({
    'projects/club.md':
      '# 読書会\n\n- 通知はメールだけ。リマインダーは postbox 経由でメールで送る。\n- 会員は 9 人で、次の開催は月末の土曜。',
    'projects/cat.md':
      '# 猫\n\n- postbox は 1 日に 200 通までしか受け付けず、超えた分は黙って捨てられる。\n- むぎの映像は外に出さない。家のサーバーにだけ保存する。',
  })
  const limits = { lines: 6, rare: 3, shared: 2, perFile: 2, floor: 5 }

  it('finds names in Latin letters and katakana', () => {
    expect(names('postbox で 320 人にメールを送る。OK?')).toEqual(['postbox', 'メール'])
  })

  it('brings every line that has a rare name, whatever else is asked', () => {
    const found = recall('来週 320 人に案内を postbox で一斉に出したい', lines, limits)
    expect(found.map((line) => line.file).toSorted()).toEqual([
      'projects/cat.md',
      'projects/club.md',
    ])
  })

  it('brings nothing for a few words that name nothing', () => {
    expect(recall('ありがとう', lines, limits)).toEqual([])
  })
})

describe('naming', () => {
  const lines = noteLines({
    'a.md': [
      '- 11/16 の朝にレビューを頼む。',
      '- 2026-11-16 23:00 にトークンを戻す。',
      '- 11 月 16 日は出かける予定。',
      '- 11/6 に送金した。11/160 件のうち 3 件。',
      '- 1/16 と 2025-11-16 は別の日。',
      '- 締め切りは 2026-11-17。',
    ].join('\n'),
  })

  it('finds the day however it is written, and no other day', () => {
    expect(naming('2026-11-16', lines).map((line) => line.line)).toEqual([1, 2, 3])
  })
})

describe('related', () => {
  const lines = noteLines({
    'projects/kiln.md':
      '# kiln\n\n- デプロイが途中で失敗したら、最初からやり直す（40 分かかる）。\n- 設定は kiln.toml に書く。',
    'projects/blog.md':
      '# ブログ\n\n- kiln は `kiln deploy --resume <id>` で落ちたところから再開できる。\n- 画像は 1,400 枚ある。',
    'projects/cat.md': '# 猫\n\n- むぎの映像は外に出さない。家のサーバーにだけ保存する。',
  })

  it('finds what another file says about the same thing', () => {
    const found = related('kiln のデプロイは途中から再開できない。最初からやり直す。', lines, 2, 1)
    expect(found.map((line) => line.file)).toEqual(['projects/kiln.md', 'projects/blog.md'])
  })

  it('takes at most the asked number of lines from one file', () => {
    const found = related('kiln', lines, 5, 1)
    expect(found.filter((line) => line.file === 'projects/kiln.md')).toHaveLength(1)
  })

  it('finds nothing for words no note has', () => {
    expect(related('zzzz', lines, 5, 2)).toEqual([])
  })
})
