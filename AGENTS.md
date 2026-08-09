# AI collaboration rules — Chenlin Planet Template

## Work in phases

1. **Read-only first.** Before editing, read `README.md`, `docs/`, `src/data/loveData.js`, `src/main.jsx`, and `src/styles.css`. Return a Chinese feature/state map, risks, and a file-by-file plan.
2. **Discuss before implementation.** For a new idea, propose 2–3 user-experience options and wait for the user to choose one.
3. **Implement one verified slice at a time.** Do not rewrite `src/main.jsx` wholesale. Make a small coherent change, then test it before the next slice.
4. **Verify before claiming success.** Run `npm run check`; use a browser to exercise the affected CTA/navigation/game path; inspect console errors and narrow-screen layout.

## Project invariants

- The visible reference calendar contains only Day 01, 02, 03, 05, and 08.
- Day 05 starts directly in the playable maze; do not restore the old crash / pull-cord / fake Day4 flow.
- Day 05 completion enables `interstellar-voyage-theme`; Day 08 is a post-theme independent game example.
- Preserve the selected Day1/2/3/8 interaction images. Do not restore photo-wall, private-gallery, gift, or original-video media from deployment history.
- Keep private data out of commits: `.env.local`, secrets, deployment history, `node_modules/`, `dist/`, and unapproved images/videos must remain excluded.

## Animation and asset rules

- Propose a storyboard/static composition before coding non-trivial animation.
- Provide `prefers-reduced-motion`, keyboard/touch alternatives, and a mobile layout.
- Avoid perpetual full-screen filters, expensive particle loops, or dependencies for simple CSS effects.
- Use only original or clearly licensed art. Keep generated-image prompts/workflows and raw assets private; commit only approved public exports.

## Change discipline

- Keep changes scoped to the requested feature.
- Do not run destructive commands or alter unrelated files without explicit approval.
- Review `git diff` before committing. Do not push or deploy unless explicitly asked.
