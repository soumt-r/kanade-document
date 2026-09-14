import { runHaja } from '../src/utils/kanade/index.ts';

const code = `
【座標】を設計しよう:
    『x』を【数字】の0にしよう
    『y』を【数字】の0にしよう
    
    最初に作られる時(【数字】の『初期x』,【数字】の『初期y』)次のようにしよう:
        『私』の『x』を『初期x』にしよう
        『私』の『y』を『初期y』にしよう
        
    【論理】を返す〈記号 同じだ〉を作ろう(【座標】の『対象』):
        もし(『私』の『x』と『対象』の『x』が違う)なら:
            偽を返そう
        もし(『私』の『y』と『対象』の『y』が違う)なら:
            偽を返そう
        真を返そう

『点1』を【座標】の新しい【座標】(10,20)にしよう
『点2』を【座標】の新しい【座標】(10,20)にしよう

もし(『点1』と『点2』が同じだ)なら:
    「二つの座標の位置が同じです！」を出力しよう
`;

async function main() {
    console.log("--- 実行開始 ---");
    let output = "";
    await runHaja(code, async () => "", (msg) => {
        process.stdout.write(msg);
        output += msg;
    });
    console.log("\\n--- 実行終了 ---");
}

main().catch(e => console.error(e));
