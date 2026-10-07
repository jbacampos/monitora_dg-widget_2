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
let destroyCallback = null;
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
    registerDestroyCallback: fn => {
        destroyCallback = fn;
    }
};

// --- Controle de tempo e do setInterval para os testes de duração ---
let fakeNow = D("2026-10-07T10:40:00Z");
Date.now = () => fakeNow;

let setIntervalCount = 0;
let clearIntervalCount = 0;
let intervalDelay = null;
const intervalFns = [];
global.setInterval = function (fn, delay) {
    setIntervalCount++;
    intervalDelay = delay;
    intervalFns.push(fn);
    return { id: setIntervalCount };
};
global.clearInterval = function () {
    clearIntervalCount++;
};

global.container = container;
global.ctx = ctx;

vm.runInThisContext(src, { filename: "script.js" });

const p2 = n => String(n).padStart(2, "0");
const expDate = ts => {
    const d = new Date(ts);
    return p2(d.getUTCDate()) + "/" + p2(d.getUTCMonth() + 1);
};
const expClock = ts => {
    const d = new Date(ts);
    return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes());
};
// Círculo do estado: [desligado, ligado]; mesma marcação gerada
// por script.js (função stateSymbols).
const SYMBOL = {
    rede_disponivel: ["st-off", "st-green"],
    alimentacao_rede: ["st-off", "st-blue"],
    alimentacao_offgrid: ["st-off", "st-yellow"],
    alimentacao_gerador: ["st-off", "st-red"]
};
const expStates = r =>
    KEYS.map(k =>
        '<i class="st-dot ' + SYMBOL[k][Number(r[k]) === 1 ? 1 : 0] + '"></i>'
    ).join("");

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

    // ------------------------------------------------------
    // DURAÇÃO (coluna acrescentada):
    //  1ª linha viva, demais fixas, última sem informação.
    // ------------------------------------------------------
    const reDur = /<span class="seq-date">([\s\S]*?)<\/span><span class="seq-clock">([\s\S]*?)<\/span><span class="seq-states">([\s\S]*?)<\/span><span class="seq-duration"(?: id="seq-live-duration")?>([\s\S]*?)<\/span>/;

    function readRows() {
        const h = elements.sequence ? elements.sequence.innerHTML : "";
        return h.split('<div class="seq-row">').slice(1).map(c => {
            const m = c.match(reDur);
            return m
                ? { date: m[1], clock: m[2], states: m[3], duration: m[4] }
                : null;
        });
    }

    let rows3 = readRows();

    // (1) Primeira linha: duração viva = Date.now() - ts da 1ª linha.
    //     fakeNow = 10:40:00Z, 1ª linha = 10:35:00Z -> "5m 0s".
    check("duracao: 1a linha viva", rows3[0].duration, "5m 0s");

    // (3) Duração correta entre duas transições (linha acima - linha).
    check("duracao: linha 2", rows3[1].duration, "7m 55s");
    check("duracao: linha 3", rows3[2].duration, "11m 47s");
    check("duracao: linha 4", rows3[3].duration, "27m 16s");
    check("duracao: linha 5 (horas)", rows3[4].duration, "11h 35m 20s");

    // (5) Última linha: sem informação suficiente -> "—".
    check("duracao: ultima linha sem info", rows3[rows3.length - 1].duration, "—");

    // (6) Formatação compacta: segundos, minutos, horas e dias.
    check("fmt 7s", formatDuration(7000), "7s");
    check("fmt 2m 13s", formatDuration(133000), "2m 13s");
    check("fmt 11m 47s", formatDuration(707000), "11m 47s");
    check("fmt 1h 6m 32s", formatDuration(3992000), "1h 6m 32s");
    check("fmt 2d 4h 18m 7s", formatDuration(188287000), "2d 4h 18m 7s");

    // (2) Avanço de 1 segundo: só a 1ª linha muda, via setInterval único.
    check("timer: um unico setInterval", String(setIntervalCount), "1");
    check("timer: intervalo 1000ms", String(intervalDelay), "1000");
    const httpBefore = httpCalls;
    fakeNow += 1000;
    if (intervalFns[0]) { intervalFns[0](); }
    check("duracao: 1s depois (viva)", elements["seq-live-duration"].textContent, "5m 1s");

    // (7) O contador não gera novo request ao ThingsBoard.
    check("timer: sem novo http.get", String(httpCalls), String(httpBefore));

    // (4) Nova transição: a antiga 1ª linha passa a duração fixa.
    //     fakeNow = 10:40:01Z, nova linha = 10:38:00Z.
    const changed2 = {
        rede_disponivel: "1",
        alimentacao_rede: "1",
        alimentacao_offgrid: "0",
        alimentacao_gerador: "0"
    };
    const newTs2 = D("2026-10-07T10:38:00Z");
    onDataUpdated({ data: subData(newTs2, changed2) });
    rows3 = readRows();
    check("duracao: +1 linha apos transicao", String(rows3.length), String(rowsData.length + 2));
    check("duracao: nova 1a linha viva", rows3[0].duration, "2m 1s");
    check("duracao: antiga 1a linha fixa", rows3[1].duration, "3m 0s");
    check("duracao: demais inalteradas", rows3[2].duration, "7m 55s");
    check("timer: continua um setInterval", String(setIntervalCount), "1");

    // (8) Timer removido no destroy.
    if (typeof destroyCallback === "function") { destroyCallback(); }
    check("destroy: clearInterval chamado", String(clearIntervalCount), "1");

    console.log("");
    console.log("Resumo: " + passed + " passaram, " + failed + " falharam.");
    process.exit(failed === 0 ? 0 : 1);
}, 50);
