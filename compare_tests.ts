import { readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { Lexer } from './src/utils/kanade/lexer.ts';
import { Parser } from './src/utils/kanade/parser.ts';
import { KanadeInterpreter as Interpreter } from './src/utils/kanade/interpreter.ts';
import { registerStandardLibrary } from './src/utils/kanade/stdlib.ts';
import { JapaneseConfig } from './src/utils/kanade/config.ts';
import { localize, syntaxError } from './src/utils/kanade/errs.ts';

const DOCS_DIR = './src/pages/docs';

// 난수와 현재 시각을 쓰는 예제는 실행마다 결과가 달라서, 에러 없이 끝나는지만 본다.
const NONDETERMINISTIC = /【乱数】|〈今〉/;
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

// 에러도 비교한다: 실행이 에러로 끝나면 그 문구(현지화된 최종 메시지)를 출력 뒤에
// 붙여서, TS 엔진이 Go 엔진과 같은 문구를 내는지 잡아낸다. Go 쪽은 stderr의
// "ランタイムエラー: <メッセージ>" 줄에서 같은 메시지를 뽑는다.
async function runTypeScriptEngine(code: string, stdin = ''): Promise<string> {
    let output = "";
    let error = "";
    try {
        const lexer = new Lexer(code);
        const parser = new Parser(lexer.tokens);
        const ast = parser.parseProgram();
        const lines = stdin === '' ? [] : stdin.replace(/\n$/, '').split('\n');
        const interpreter = new Interpreter(ast, async () => lines.shift() ?? "");
        registerStandardLibrary(interpreter);

        interpreter.outputCallback = (msg) => {
            output += msg;
        };
        await interpreter.run();
    } catch (e: any) {
        error = String(e?.message ?? e);
    }
    return withError(output.trim(), error);
}

function withError(output: string, error: string): string {
    return error ? `${output}\n!! ${error}` : output;
}

function runGoEngine(code: string, stdin = ''): string {
    // .knd 확장자여야 hana.exe가 Kanade 렉서/파서로 실행한다(cmd/run.go의
    // isKanade := strings.HasSuffix(filename, ".knd")).
    const tempFile = 'temp_test.knd';
    writeFileSync(tempFile, code);

    try {
        const result = execSync(`${GO_EXECUTABLE} run ${tempFile}`, { input: stdin, stdio: ['pipe', 'pipe', 'pipe'] });
        unlinkSync(tempFile);
        return result.toString().trim();
    } catch (e: any) {
        unlinkSync(tempFile);
        const stdout = e.stdout ? e.stdout.toString().trim() : "";
        const stderr = e.stderr ? e.stderr.toString() : "";
        const m = stderr.match(/^ランタイムエラー: (.*)$/m);
        return withError(stdout, m ? m[1].trim() : "");
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

// 문서 예제에는 없지만 두 엔진이 같아야 하는 동작: 표준 라이브러리(std) 임포트.
const EXTRA_CASES: { name: string; code: string; stdin?: string }[] = [
    { name: "std 임포트", code: "【数学】から〈切り上げ〉を持ってこよう\n枠「{〈切り上げ〉(3.2)}」を出力しよう" },
    { name: "std 임포트 (별칭)", code: "【数学】から〈切り捨て〉を〈床〉に持ってこよう\n枠「{〈床〉(3.9)}」を出力しよう" },
    { name: "없는 모듈", code: "【なにもない】から〈関数〉を持ってこよう" },
    { name: "없는 함수", code: "【数学】から〈ない関数〉を持ってこよう" },
    { name: "끝없는 재귀", code: "〈f〉を作ろう ():\n    〈f〉()を実行しよう\n〈f〉()を実行しよう" },
    { name: "입력 (문자열)", code: "『名前』を【文字列】で入力してもらおう\n『名前』を出力しよう", stdin: "田中\n" },
    { name: "입력 (숫자, 공백 허용)", code: "『年齢』を【数字】で入力してもらおう\n枠「{『年齢』 + 1}」を出力しよう", stdin: " 20 \n" },
    { name: "입력 (논리)", code: "『はい』を【論理】で入力してもらおう\n『はい』を出力しよう", stdin: "真\n" },
    { name: "입력 (숫자 실패)", code: "『年齢』を【数字】で入力してもらおう\n『年齢』を出力しよう", stdin: "二十\n" },
    { name: "입력 (빈 입력은 숫자가 아님)", code: "『年齢』を【数字】で入力してもらおう\n『年齢』を出力しよう", stdin: "" },
    { name: "타입: 선언 불일치", code: "『a』を【数字】の「文字」にしよう" },
    { name: "타입: 재대입 불일치", code: "『a』を【数字】の3にしよう\n『a』を「x」にしよう" },
    { name: "타입: 비어있음 허용", code: "『a』を【数字】の3にしよう\n『a』を空っぽにしよう\n『a』を出力しよう" },
    { name: "타입: 제네릭 push", code: "『目録』を【(数字)リスト】の【1,2】にしよう\n『目録』の後に「三」を追加しよう" },
    { name: "타입: 제네릭 사전", code: "『点数』を【(文字列,数字)辞書】の{「国語」:「九十」}にしよう" },
    { name: "타입: 매개변수", code: "〈二倍〉を作ろう(【数字】の『値』):\n    (『値』 * 2)を出力しよう\n〈二倍〉(「文字」)を実行しよう" },
    { name: "타입: 업캐스팅", code: "【動物】を設計しよう:\n    『名前』を【文字列】の「動物」にしよう\n【動物】をもとにして【子犬】を設計しよう:\n    『芸』を【文字列】の「おすわり」にしよう\n【猫】を設計しよう:\n    『名前』を【文字列】の「ミケ」にしよう\n『友達』を【動物】の新しい【子犬】()にしよう\n『友達』の『芸』を出力しよう" },
    { name: "타입: 낯선 클래스", code: "【動物】を設計しよう:\n    『名前』を【文字列】の「動物」にしよう\n【動物】をもとにして【子犬】を設計しよう:\n    『芸』を【文字列】の「おすわり」にしよう\n【猫】を設計しよう:\n    『名前』を【文字列】の「ミケ」にしよう\n『友達』を【動物】の新しい【猫】()にしよう" },
    { name: "타입: 필드 쓰기", code: "【人】を設計しよう:\n    『年齢』を【数字】の20にしよう\n『太郎』を【人】の新しい【人】()にしよう\n『太郎』の『年齢』を「二十」にしよう" },
    { name: "연산: 숫자 + 문자열", code: "(10 + 「こんにちは」)を出力しよう" },
    { name: "연산: 문자열 - 문자열", code: "(「あ」 - 「い」)を出力しよう" },
    { name: "연산: 문자열 + 문자열", code: "(「あ」 + 「い」)を出力しよう" },
    { name: "연산: 비어있음 피연산자", code: "(1 + 空っぽ)を出力しよう" },
    { name: "연산: 비어있음 동등 비교", code: "(空っぽ == 空っぽ)を出力しよう" },
    { name: "연산: 복합 대입", code: "『a』を「x」にしよう\n『a』に3を足そう" },
    { name: "추상: 인터페이스 생성", code: "【飛べるもの】を規定しよう:\n    〈飛ぶ〉がなければならない()\n新しい【飛べるもの】()を実行しよう\n「作られた」を出力しよう" },
    { name: "추상: 추상 클래스 생성", code: "【図形】を下設計しよう:\n    〈面積〉を作ろう():\n        1を出力しよう\n新しい【図形】()を実行しよう\n「作られた」を出力しよう" },
    { name: "추상: 자식 클래스는 생성 가능", code: "【図形】を下設計しよう:\n    〈面積〉がなければならない()\n【図形】をもとにして【四角形】を設計しよう:\n    【数字】を返す〈面積〉を作ろう():\n        6を返そう\n『形』を【図形】の新しい【四角形】()にしよう\n(『形』の〈面積〉())を出力しよう" },
    { name: "불변: 문자열 글자 재대입", code: "『名前』を「山田」にしよう\n『名前』の1番目を「田」にしよう\n『名前』を出力しよう" },
    { name: "표준: JSON 파싱", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n『値』を〈パース〉(「{\"a\": [1, {\"b\": true}], \"c\": null}」)にしよう\n『値』を出力しよう" },
    { name: "표준: JSON 문자열화 키 정렬", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n〈文字列化〉({「b」: 1, 「a」: 【真, 空っぽ, 「x」】})を出力しよう" },
    { name: "표준: JSON 들여쓰기", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n〈文字列化〉({「a」: 【1, 2】, 「b」: {}}, 2)を出力しよう" },
    { name: "표준: JSON 숫자 형식", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n〈文字列化〉(【0.5, 100, 2.25, 0.0000001, 1000000000000000000000】)を出力しよう" },
    { name: "표준: JSON 왕복", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n〈パース〉(〈文字列化〉({「名前」: 「はな」}))を出力しよう" },
    { name: "표준: JSON 잘못된 입력", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n〈パース〉(「{」)を出力しよう" },
    { name: "표준: JSON 문자열 아닌 키", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n〈文字列化〉({1: 2})を出力しよう" },
    { name: "표준: JSON 범위 밖 숫자", code: "【JSON】から〈パース〉を持ってこよう\n【JSON】から〈文字列化〉を持ってこよう\n〈パース〉(「1e999」)を出力しよう" },
    { name: "표준: 무작위 정수 범위", code: "【乱数】から〈実数〉を持ってこよう\n【乱数】から〈整数〉を持ってこよう\n【乱数】から〈選ぶ〉を持ってこよう\n【乱数】から〈シャッフル〉を持ってこよう\n『値』を〈整数〉(3, 5)にしよう\n(『値』 >= 3)を出力しよう" },
    { name: "표준: 무작위 정수 뒤집힘", code: "【乱数】から〈実数〉を持ってこよう\n【乱数】から〈整数〉を持ってこよう\n【乱数】から〈選ぶ〉を持ってこよう\n【乱数】から〈シャッフル〉を持ってこよう\n〈整数〉(3, 1)を出力しよう" },
    { name: "표준: 무작위 정수 소수", code: "【乱数】から〈実数〉を持ってこよう\n【乱数】から〈整数〉を持ってこよう\n【乱数】から〈選ぶ〉を持ってこよう\n【乱数】から〈シャッフル〉を持ってこよう\n〈整数〉(1.5, 3)を出力しよう" },
    { name: "표준: 무작위 빈 목록", code: "【乱数】から〈実数〉を持ってこよう\n【乱数】から〈整数〉を持ってこよう\n【乱数】から〈選ぶ〉を持ってこよう\n【乱数】から〈シャッフル〉を持ってこよう\n『空』を【(何でも)リスト】の【】にしよう\n〈選ぶ〉(『空』)を出力しよう" },
    { name: "표준: 무작위 섞기 길이", code: "【乱数】から〈実数〉を持ってこよう\n【乱数】から〈整数〉を持ってこよう\n【乱数】から〈選ぶ〉を持ってこよう\n【乱数】から〈シャッフル〉を持ってこよう\n『元』を【1, 2, 3, 4】にしよう\n『混ぜた』を〈シャッフル〉(『元』)にしよう\n『混ぜた』の『長さ』を出力しよう\n『元』を出力しよう" },
    { name: "표준: 날짜 왕복", code: "【日時】から〈書式〉を持ってこよう\n【日時】から〈読み取り〉を持ってこよう\n〈書式〉(〈読み取り〉(「2024-03-05 07:08:09」, 「YYYY-MM-DD HH:mm:ss」), 「YYYY/MM/DD HH:mm:ss」)を出力しよう" },
    { name: "표준: 날짜 서식 글자", code: "【日時】から〈書式〉を持ってこよう\n【日時】から〈読み取り〉を持ってこよう\n〈書式〉(〈読み取り〉(「2024-03-05」, 「YYYY-MM-DD」), 「YYYY年MM月DD日」)を出力しよう" },
    { name: "표준: 날짜 없는 날", code: "【日時】から〈書式〉を持ってこよう\n【日時】から〈読み取り〉を持ってこよう\n〈読み取り〉(「2024-02-30」, 「YYYY-MM-DD」)を出力しよう" },
    { name: "표준: 날짜 서식 불일치", code: "【日時】から〈書式〉を持ってこよう\n【日時】から〈読み取り〉を持ってこよう\n〈読み取り〉(「2024/03/05」, 「YYYY-MM-DD」)を出力しよう" },
    { name: "표준: 날짜 부호", code: "【日時】から〈書式〉を持ってこよう\n【日時】から〈読み取り〉を持ってこよう\n〈読み取り〉(「2024-+3-05」, 「YYYY-MM-DD」)を出力しよう" },
    { name: "표준: 정규식 일본어", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈検索〉(「abcひらがなdef」, 「[ぁ-ん]+」)を出力しよう" },
    { name: "표준: 정규식 없음", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈検索〉(「abc」, 「[0-9]+」)を出力しよう" },
    { name: "표준: 정규식 그룹", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈グループ〉(「b」, 「(a)|(b)」)を出力しよう" },
    { name: "표준: 정규식 치환 그룹", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈置換〉(「山田 鈴木」, 「([^ ]+) ([^ ]+)」, 「$2 $1」)を出力しよう" },
    { name: "표준: 정규식 치환 달러", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈置換〉(「a1」, 「[0-9]」, 「$x$$」)を出力しよう" },
    { name: "표준: 정규식 없는 그룹", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈置換〉(「a1」, 「[0-9]」, 「<$3>」)を出力しよう" },
    { name: "표준: 정규식 분할", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈分割〉(「a, b,c」, 「, ?」)を出力しよう" },
    { name: "표준: 정규식 분할 캡처", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈分割〉(「a1b2c」, 「([0-9])」)を出力しよう" },
    { name: "표준: 정규식 모두 없음", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈全検索〉(「abc」, 「[0-9]」)を出力しよう" },
    { name: "표준: 정규식 모두찾기", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈全検索〉(「a1b22c333」, 「[0-9]+」)を出力しよう" },
    { name: "표준: 정규식 잘못된 패턴", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈検査〉(「a」, 「(」)を出力しよう" },
    { name: "표준: 정규식 대소문자 플래그", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈検査〉(「ABC」, 「(?i)abc」)を出力しよう" },
    { name: "표준: 정규식 인자 종류", code: "【正規表現】から〈検査〉を持ってこよう\n【正規表現】から〈検索〉を持ってこよう\n【正規表現】から〈グループ〉を持ってこよう\n【正規表現】から〈全検索〉を持ってこよう\n【正規表現】から〈置換〉を持ってこよう\n【正規表現】から〈分割〉を持ってこよう\n〈検査〉(1, 「a」)を出力しよう" },
    { name: "표준: 요일 월요일", code: "【日時】から〈読み取り〉を持ってこよう\n【日時】から〈曜日〉を持ってこよう\n〈曜日〉(〈読み取り〉(「2024-03-04」, 「YYYY-MM-DD」))を出力しよう" },
    { name: "표준: 요일 일요일", code: "【日時】から〈読み取り〉を持ってこよう\n【日時】から〈曜日〉を持ってこよう\n〈曜日〉(〈読み取り〉(「2024-03-10」, 「YYYY-MM-DD」))を出力しよう" },
    { name: "표준: 요일 인자 종류", code: "【日時】から〈曜日〉を持ってこよう\n〈曜日〉(「月」)を出力しよう" },
];

// 구문 오류 문구: TS 엔진의 진단을 현지화한 문장이 hana가 보여 주는 문장과 같아야 한다.
const SYNTAX_CASES: string[] = ["「あ」を出力しよう )", "「あ」を出力しよう ＠", "1 +"];

function goSyntaxMessages(code: string): string[] {
    const tempFile = 'temp_syntax.knd';
    writeFileSync(tempFile, code);
    let stdout = '';
    try {
        stdout = execSync(`${GO_EXECUTABLE} run ${tempFile}`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    } catch (e: any) {
        stdout = e.stdout ? e.stdout.toString() : '';
    }
    unlinkSync(tempFile);
    return stdout.split(/\r?\n/).filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));
}

function tsSyntaxMessages(code: string): string[] {
    const parser = new Parser(new Lexer(code).tokens);
    parser.parseProgram();
    return parser.diagnostics.map((d) => localize(JapaneseConfig.locale, syntaxError(d)));
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

            if (tsOutput === goOutput || (NONDETERMINISTIC.test(code) && !tsOutput.includes('!! ') && !goOutput.includes('오류') && !goOutput.includes('エラー'))) {
                passed++;
            } else {
                console.log(`❌ [불일치] 파일: ${path} (블록 ${i + 1})`);
                console.log(`-- 코드 --\n${code.trim()}`);
                console.log(`-- TS 출력 --\n${tsOutput}`);
                console.log(`-- Go 출력 --\n${goOutput}\n`);
            }
        }
    });

    for (const c of EXTRA_CASES) {
        total++;
        const tsOutput = await runTypeScriptEngine(c.code, c.stdin);
        const goOutput = runGoEngine(c.code, c.stdin);
        if (tsOutput === goOutput) {
            passed++;
        } else {
            console.log(`❌ [불일치] 추가 케이스: ${c.name}`);
            console.log(`-- 코드 --
${c.code}`);
            console.log(`-- TS 출력 --
${tsOutput}`);
            console.log(`-- Go 출력 --
${goOutput}
`);
        }
    }

    for (const code of SYNTAX_CASES) {
        total++;
        const ts = tsSyntaxMessages(code).join('\n');
        const go = goSyntaxMessages(code).join('\n');
        if (ts === go && ts !== '') {
            passed++;
        } else {
            console.log(`❌ [불일치] 구문 오류 케이스: ${code}`);
            console.log(`-- TS --\n${ts}`);
            console.log(`-- Go --\n${go}\n`);
        }
    }

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
