import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runHari } from '../src/utils/kanade/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.resolve(__dirname, '../src/pages/docs');

let errorCount = 0;
let fileCount = 0;
let blockCount = 0;

async function checkCodeBlock(code: string, filePath: string, expectError: boolean) {
  blockCount++;
  try {
    // Provide a dummy input callback to prevent hanging on input
    const dummyInput = async (promptText: string) => {
      if (promptText.includes('숫자')) return '10';
      if (promptText.includes('이름')) return '테스트';
      return '입력';
    };
    
    // Discard output so it doesn't clutter the console
    const discardOutput = (msg: string) => {};

    await runHari(code, dummyInput, discardOutput);
    if (expectError) {
       errorCount++;
       console.error('\\n❌ [예상된 에러 누락] 파일: ' + path.relative(process.cwd(), filePath));
       console.error('코드:\\n' + code);
       console.error('기대: 에러가 발생해야 하는데 정상 실행되었습니다!\\n');
    }
  } catch (e: any) {
    if (expectError) {
       // Good, it failed as expected
    } else {
       errorCount++;
       console.error('\\n❌ [예상치 못한 에러] 파일: ' + path.relative(process.cwd(), filePath));
       console.error('코드:\\n' + code);
       console.error('발생한 에러: ' + (e.message || String(e)) + '\\n');
    }
  }
}

async function walkDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      await walkDir(fullPath);
    } else if (fullPath.endsWith('.md')) {
      fileCount++;
      const content = fs.readFileSync(fullPath, 'utf8');
      const regex = /```kanade([^\n]*)\n([\s\S]*?)```/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const meta = match[1].trim();
        const expectError = meta.includes('fail');
        await checkCodeBlock(match[2].trim(), fullPath, expectError);
      }
    }
  }
}

async function main() {
  console.log('🔍 마크다운(Markdown) 문서 내 Kanade 코드 블록 런타임 검증을 시작합니다...\\n');
  await walkDir(docsDir);

  console.log('=========================================');
  console.log('총 검증된 파일: ' + fileCount + '개');
  console.log('총 실행된 코드 블록: ' + blockCount + '개');

  if (errorCount > 0) {
    console.error('🚨 총 ' + errorCount + '개의 테스트가 실패했습니다.');
    process.exit(1);
  } else {
    console.log('✅ 모든 코드 블록이 완벽하게 검증되었습니다! (의도된 에러 포함)');
    process.exit(0);
  }
}

main();
