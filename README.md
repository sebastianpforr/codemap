# codemap

Draws a repository, a folder or a pasted snippet the way you would explain it to a layperson at a whiteboard: the domain modules, the **ports** (contracts), the **adapters** to the outside world, the entry points, and what cuts across everything, such as error handling and logging.

The result is **one offline HTML file**. No server, no upload, no dependencies (Node 18 or newer). Source code is never copied into it, only paths, names, line counts, references with file and line, and a short comment excerpt.

> **Interface language:** the viewer and its explanations are currently in German. The code, CLI options and this README are in English; a German README is in [README.de.md](README.de.md).

## Quick start

```bash
git clone https://github.com/sebastianpforr/codemap.git
cd codemap
node bin/codemap.mjs /path/to/your/repo --name MyProject      # writes codemap-MyProject.html
node bin/codemap.mjs src/module.ts                            # a single file as a snippet
cat snippet.py | node bin/codemap.mjs --stdin --lang py       # code from standard input
node bin/codemap.mjs repo --json model.json --fragment        # model as JSON, HTML as page content only
node --test test/                                             # tests
```

Open the HTML file in any browser. It works offline and can be mailed or archived.

## What you see

- **Centre (hexagon):** the domain modules, ordered by coupling. The edge of the hexagon is the boundary of the domain logic.
- **On the hexagon edge:** the ports, in the colour of the module they belong to.
- **Left:** entry points (HTTP, UI, CLI). **Right:** adapters to the outside world and the external libraries they use. **Top:** orchestration (workflows, jobs). **Bottom:** start-up and wiring, shared helpers and the **cross-cutting** concerns.
- **Cross-cutting concerns** (error handling, logging, diagnostics) are not drawn as a hundred lines but as a bar at the bottom and a coloured dot on every block that uses them. The text above names who is *not* connected.
- **Red** always means a rule violation: domain logic reaches outwards. **Orange** is a hint (an entry point bypasses the core, an adapter uses another adapter, one domain module reaches into another). Everything else is grey.
- **Click** a block: everything except its connections is greyed out. The side panel gives a plain-language sentence, the comment excerpt, who uses it and whom it uses, libraries, files and findings with file and line. For ports it shows the schema (interfaces, types, Zod schemas with members); for adapters the ports they implement.
- **Inside view** (double-click, button, or zoom in far): the module opens up and shows its files, with users on the left and dependencies on the right, line by line per file. Zooming further turns files into cards with functions, classes, interfaces and schemas. Zooming out goes back.
- **Navigation:** wheel zooms, drag pans, double-click opens, right-click or Esc goes one level up, middle click fits everything; a breadcrumb bar with an "up one level" button. Pinch and swipe on a phone.
- **Chat "Questions about the code"** (third column): only when the page is published as a Claude artifact. It asks Claude through the viewer's own Claude account (artifact capability `sample`), no API key, and gives it lookup tools over the map data. Claude sees structure and signatures, not source code.

## Language support

Detection is based on **conventions and patterns, not on a full parser**. Languages differ in how much can be read:

| Language | Extensions | Cross-file references | Symbols (functions, types) |
| --- | --- | --- | --- |
| TypeScript / JavaScript | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` | Best: relative paths, index files, `tsconfig` path aliases, monorepo packages, re-exports, type-only imports | Best: functions, classes, interfaces, types, Zod schemas, members |
| Python | `.py` | Good: relative, absolute and namespace packages | Good: classes, functions |
| Java, Kotlin, Scala | `.java .kt .kts .scala` | Good: via `package` and `import`; a wildcard import points to one file of the package | Classes, interfaces, traits (generic patterns) |
| Go | `.go` | Good: module path from `go.mod`, import points to the package directory (first file) | Types, interfaces, functions (generic patterns) |
| Rust | `.rs` | Good: `mod`, `use crate::…`, `super`, `self` | Traits, structs, enums (generic patterns) |
| PHP | `.php` | Good: `use` with namespaces, assumes folders follow namespaces (PSR-4 style) | Classes, interfaces, traits |
| C# | `.cs` | Good: `using` resolved through `namespace` declarations | Classes, interfaces, records |

Each language is covered by a test in [`test/languages.test.mjs`](test/languages.test.mjs) that builds a small hexagon and checks references, roles, symbols and external packages.

**Not supported:** Ruby, C/C++, Swift, Dart, Elixir and everything else not listed above. A folder with no supported files ends with the message "no source files found" and exit code 2. Mixed repositories work; unsupported files are simply left out.

## How roles are recognised

1. **Roles from folder names** (`modules`, `adapters`, `contracts`, `entrypoints`, `runtime`, `orchestration`, `diagnostics` and common variants, see `src/model.mjs`). The outermost matching folder wins; the folder below it names the block (`adapters/notion/…` becomes "Notion"). Without a recognisable structure, blocks follow the folders; loose files in the root are shown one by one.
2. **Cross-cutting concerns** automatically: files named like `fault`, `errors`, `diagnostics`, `logger` that sit in such a folder or are used by at least three blocks, plus unclassified blocks that almost everything uses.
3. **Direction of dependencies:** domain logic and ports must not point at adapters, entry points, orchestration or start-up (red).
4. Tests are skipped (`--include-tests` to keep them).
5. Per-repository tuning with a `codemap.config.json` (your own folder words, excluded paths, extra cross-cutting topics); see [`codemap.config.example.json`](codemap.config.example.json).

## Limits

- Detection is convention-based. A repository whose folders say nothing about roles appears as blocks by folder; it is still a usable dependency map, but not a hexagon. Accuracy on foreign repositories has been checked on a handful of examples only.
- Imports are read by pattern: dynamic imports with variables, macros and code generation are missed.
- Symbols are read by pattern, best for TypeScript/JavaScript and Python. At most 24 members per symbol.
- The chat answers only what follows from structure and signatures. For questions about runtime behaviour in the source you need a coding agent with file access.
- Snippet mode finds references by names in the text and roles by name endings (`Port`, `Adapter`, `Controller`). For text from standard input, `--lang` is `js`, `py` or `java`; for a file the extension decides.
- Present state only: no comparison of two revisions, no CI check, no Mermaid/PNG export yet.
- The interface is German only.

## Use as a Claude artifact

`--fragment` writes only the page content, so the file can be published as an artifact (for example with the Artifact tool of Claude Code). Only there does the chat column work; in a plain browser it stays visible but explains that the chat needs the published version. Declare the capability `sample` when publishing.

## Project layout

- `bin/codemap.mjs` command line
- `src/scan.mjs` files and imports, `src/model.mjs` roles, blocks, violations, `src/snippet.mjs` snippets, `src/render.mjs` HTML, `src/template.html` viewer
- `test/` tests, `docs/inspirations.md` what was learned from other open-source tools (in German)

## Credits

Ideas (not code) from hexwright, dependency-cruiser, dep-tree and wirehouse, all MIT; see [docs/inspirations.md](docs/inspirations.md).

## License

MIT, see [LICENSE](LICENSE).
