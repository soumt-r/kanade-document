import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { Lexer } from './src/utils/kanade/lexer.ts';
import { Parser } from './src/utils/kanade/parser.ts';
import { KanadeInterpreter as Interpreter } from './src/utils/kanade/interpreter.ts';
import { registerStandardLibrary } from './src/utils/kanade/stdlib.ts';

const DOCS_DIR = './src/pages/docs';
const GO_EXECUTABLE = '..\\hana\\hana.exe';

function extractKanadeBlocks(markdown: string): string[] {
    const blocks: string[] = [];
    const regex = /```kanade([^\n]*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(markdown)) !== null) {
        blocks.push(match[2]);
    }
    return blocks;
}

async function runTypeScriptEngine(code: string): Promise<string> {
    let output = "";
    try {
        const lexer = new Lexer(code);
        const parser = new Parser(lexer.tokens);
        const ast = parser.parseProgram();
        const interpreter = new Interpreter(ast, async () => "");
        registerStandardLibrary(interpreter);

        interpreter.outputCallback = (msg) => {
            output += msg;
        };
        await interpreter.run();
    } catch (e: any) {
        // Ignore errors, we only care about output
    }
    return output.trim();
}

function runGoEngine(code: string): string {
    // .knd 확장자여야 hana.exe가 Kanade 렉서/파서로 실행한다(cmd/run.go의
    // isKanade := strings.HasSuffix(filename, ".knd")).
    const tempFile = 'temp_test.knd';
    writeFileSync(tempFile, code);

    try {
        const result = execSync(`${GO_EXECUTABLE} run ${tempFile}`, { stdio: ['pipe', 'pipe', 'pipe'] });
        unlinkSync(tempFile);
        return result.toString().trim();
    } catch (e: any) {
        unlinkSync(tempFile);
        return e.stdout ? e.stdout.toString().trim() : "";
    }
}

async function walk(dir: string, callback: (path: string) => Promise<void>) {
    const files = readdirSync(dir);
    for (const file of files) {
        const path = join(dir, file);
        if (statSync(path).isDirectory()) {
            await walk(path, callback);
        } else if (path.endsWith('.md') || path.endsWith('.mdx')) {
            await callback(path);
        }
    }
}

async function main() {
    console.log("🔍 TypeScript 엔진 vs Go 엔진 출력 비교를 시작합니다 (Kanade)...\n");

    let total = 0;
    let passed = 0;

    await walk(DOCS_DIR, async (path) => {
        const content = readFileSync(path, 'utf8');
        const blocks = extractKanadeBlocks(content);

        for (let i = 0; i < blocks.length; i++) {
            total++;
            const code = blocks[i];

            const tsOutput = await runTypeScriptEngine(code);
            const goOutput = runGoEngine(code);

            if (tsOutput === goOutput) {
                passed++;
            } else {
                console.log(`❌ [불일치] 파일: ${path} (블록 ${i + 1})`);
                console.log(`-- 코드 --\n${code.trim()}`);
                console.log(`-- TS 출력 --\n${tsOutput}`);
                console.log(`-- Go 출력 --\n${goOutput}\n`);
            }
        }
    });

    console.log(`=========================================`);
    console.log(`총 실행된 코드 블록: ${total}개`);
    if (passed === total) {
        console.log(`✅ 모든 코드 블록의 출력이 완벽하게 일치합니다! (${passed}/${total})`);
    } else {
        console.log(`🚨 ${total - passed}개의 테스트 출력이 불일치합니다. (${passed}/${total})`);
        process.exit(1);
    }
}

main().catch(console.error);
