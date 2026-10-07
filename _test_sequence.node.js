// ============================================================
// HARNESS DE TESTE (Node) — não faz parte do widget.
// Carrega script.js em sandbox e valida a tabela histórica:
// ordem por ts decrescente, agrupamento por data e formatos.
// Executar com TZ=UTC para resultado determinístico.
// ============================================================

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(
    path.join(__dirname, "script.js"),
    "utf8"
);

const KEYS = [
    "rede_disponivel",
    "alimentacao_rede",
    "alimentacao_offgrid",
    "alimentacao_gerador"
];

const ID = "7e62cc00-c0df-11f1-8ef7-dd61fc2d324e";

const D = s => Date.parse(s);
const rowsData = [
    { ts: D("2026-10-07T10:27:05Z"), rede_disponivel: "1", alimentacao_rede: "0", alimentacao_offgrid: "1", alimentacao_gerador: "0" },
    { ts: D("2026-10-07T10:15:18Z"), rede_disponivel: "1", alimentacao_rede: "0", alimentacao_offgrid: "0", alimentacao_gerador: "1" },
    { ts: D("2026-10-07T09:48:02Z"), rede_disponivel: "1", alimentacao_rede: "1", alimentacao_offgrid: "0", alimentacao_gerador: "0" },
    { ts: D("2026-10-06T22:12:42Z"), rede_disponivel: "1", alimentacao_rede: "1", alimentacao_offgrid: "0", alimentacao_gerador: "0" },
    { ts: D("2026-10-06T20:03:11Z"), rede_disponivel: "0", alimentacao_rede: "0", alimentacao_offgrid: "0", alimentacao_gerador: "1" }
];

function toTimeseries(rows) {
    const out = {};
    KEYS.forEach(k => { out[k] = []; });
    rows.slice().sort((a, b) => b.ts - a.ts).forEach(r => {
        KEYS.forEach(k => out[k].push({ ts: r.ts, value: r[k] }));
    });
    return out;
}

const series = toTimeseries(rowsData);

const elements = {};
const container = {
    querySelector(sel) {
        const id = sel.replace("#", "");
        if (!elements[id]) {
            elements[id] = { id, innerHTML: "", textContent: "" };
        }
        return elements[id];
    }
};

let httpCalls = 0;
let onDataUpdated = null;
const ctx = {
    http: {
        get: () => ({
            subscribe: ok => {
                httpCalls++;
                ok(series);
                return { unsubscribe() {} };
            }
        })
    },
    subscriptionApi: {
        createSubscription: options => ({
            subscribe: fn => {
                if (options && options.callbacks) {
                    onDataUpdated = options.callbacks.onDataUpdated;
                }
                fn({ id: "test-subscription", data: [] });
                return { unsubscribe() {} };
            }
        })
    },
    registerDestroyCallback: () => {}
};

global.container = container;
global.ctx = ctx;

vm.runInThisContext(src, { filename: "script.js" });

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const p2 = n => String(n).padStart(2, "0");
const expDate = ts => {
    const d = new Date(ts);
    return p2(d.getUTCDate()) + "/" + p2(d.getUTCMonth() + 1) +
        " " + WEEKDAYS[d.getUTCDay()];
};
const expClock = ts => {
    const d = new Date(ts);
    return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()) +
        ":" + p2(d.getUTCSeconds());
};
const EMOJI = {
    rede_disponivel: ["⚪", "🟢"],
    alimentacao_rede: ["⚪", "🔵"],
    alimentacao_offgrid: ["⚪", "🟡"],
    alimentacao_gerador: ["⚪", "🔴"]
};
const expStates = r =>
    KEYS.map(k => EMOJI[k][Number(r[k]) === 1 ? 1 : 0]).join(" ");

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
    if (actual === expected) {
        passed++;
        console.log("PASS  " + label + "  =>  " + actual);
    } else {
        failed++;
        console.log("FAIL  " + label +
            "  => obtido [" + actual + "] esperado [" + expected + "]");
    }
}

setTimeout(() => {
    const html = elements.sequence ? elements.sequence.innerHTML : "";

    check("http.get chamado 1x", String(httpCalls), "1");

    const chunks = html.split('<div class="seq-row">').slice(1);
    check("qtd de linhas", String(chunks.length), String(rowsData.length));

    const re = /<span class="seq-date">([\s\S]*?)<\/span><span class="seq-clock">([\s\S]*?)<\/span><span class="seq-states">([\s\S]*?)<\/span>/;
    const parsed = chunks.map(c => {
        const m = c.match(re);
        return m ? { date: m[1], clock: m[2], states: m[3] } : null;
    });

    const expected = rowsData.slice().sort((a, b) => b.ts - a.ts);

    check("ordem desc (ts 1)", String(new Date(expected[0].ts).getUTCHours()), "10");
    check("sem coluna automatico/manual", String(/source|reason|autom|manual/i.test(html)), "false");

    expected.forEach((r, i) => {
        const p = parsed[i] || {};
        const prev = expected[i - 1];
        const firstOfDay = !prev ||
            new Date(prev.ts).getUTCDate() !== new Date(r.ts).getUTCDate() ||
            new Date(prev.ts).getUTCMonth() !== new Date(r.ts).getUTCMonth();
        check(`linha ${i + 1} data`, p.date, firstOfDay ? expDate(r.ts) : "");
        check(`linha ${i + 1} hora`, p.clock, expClock(r.ts));
        check(`linha ${i + 1} estados`, p.states, expStates(r));
    });

    console.log("");
    console.log("Render:");
    parsed.forEach(p =>
        console.log(`  [${(p.date || "").padEnd(9)}] ${p.clock}  ${p.states}`)
    );

    // ------------------------------------------------------
    // Atualização ao vivo (subscription): só cria linha em
    // transição (ts novo E estados diferentes do topo).
    // ------------------------------------------------------
    function subData(ts, r) {
        return KEYS.map(k => ({
            dataKey: { name: k, type: "timeseries" },
            datasource: { entityFilter: { singleEntity: { id: ID } } },
            data: [[ts, r[k]]]
        }));
    }

    check("subscription registrada", String(typeof onDataUpdated), "function");

    // (a) Novo ts, porém MESMOS estados do topo -> sem transição.
    const topRow = expected[0];
    onDataUpdated({ data: subData(D("2026-10-07T10:30:00Z"), topRow) });
    let rows2 = (elements.sequence ? elements.sequence.innerHTML : "")
        .split('<div class="seq-row">').slice(1);
    check("sem transicao: mantem linhas", String(rows2.length), String(rowsData.length));

    // (b) ts repetido -> ignorado, mesmo com estados diferentes.
    const changed = {
        rede_disponivel: "1",
        alimentacao_rede: "0",
        alimentacao_offgrid: "0",
        alimentacao_gerador: "1"
    };
    onDataUpdated({ data: subData(topRow.ts, changed) });
    rows2 = (elements.sequence ? elements.sequence.innerHTML : "")
        .split('<div class="seq-row">').slice(1);
    check("ts repetido: mantem linhas", String(rows2.length), String(rowsData.length));

    // (c) ts novo E estados diferentes -> nova linha no topo.
    const newTs = D("2026-10-07T10:35:00Z");
    onDataUpdated({ data: subData(newTs, changed) });
    rows2 = (elements.sequence ? elements.sequence.innerHTML : "")
        .split('<div class="seq-row">').slice(1);
    check("com transicao: +1 linha", String(rows2.length), String(rowsData.length + 1));

    const m0 = rows2[0].match(re);
    check("transicao: topo data", m0 ? m0[1] : "?", expDate(newTs));
    check("transicao: topo hora", m0 ? m0[2] : "?", expClock(newTs));
    check("transicao: topo estados", m0 ? m0[3] : "?", expStates(changed));
    check("http.get continua 1x", String(httpCalls), "1");

    console.log("");
    console.log("Após transição ao vivo (3 primeiras linhas):");
    rows2.slice(0, 3).forEach(c => {
        const m = c.match(re);
        console.log(`  [${m ? (m[1] || "").padEnd(9) : "?"}] ${m ? m[2] : "?"}  ${m ? m[3] : "?"}`);
    });

    console.log("");
    console.log(`Resumo: ${passed} passaram, ${failed} falharam.`);
    process.exit(failed === 0 ? 0 : 1);
}, 50);
