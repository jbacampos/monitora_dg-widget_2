// ============================================================
// WIDGET MONITORA_DG — HISTÓRICO / SEQUÊNCIA DE ESTADOS
// ------------------------------------------------------------
// Tabela histórica dos quatro estados do snapshot, ordenada por
// ts decrescente e agrupada por data. Sem qualquer classificação
// ou inferência de automático/manual (sem source/reason).
// ============================================================

const DEVICE_MONITORA_DG =
    "7e62cc00-c0df-11f1-8ef7-dd61fc2d324e";

// Estados exibidos e o emoji ligado/desligado de cada um
// (mesma cor do widget ENERGIA DO SÍTIO). A ordem define a
// ordem das colunas.
const STATE_KEYS = [
    { key: "rede_disponivel",     on: "🟢", off: "⚪" },
    { key: "alimentacao_rede",    on: "🔵", off: "⚪" },
    { key: "alimentacao_offgrid", on: "🟡", off: "⚪" },
    { key: "alimentacao_gerador", on: "🔴", off: "⚪" }
];

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const HISTORY_LIMIT = 2000;
const MAX_ROWS = 300;

// Lista de snapshots atualmente exibida (mais recente primeiro).
// Mantida em memória para detectar transições na subscription ao vivo.
let currentSnapshots = null;

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad2(n) {
    return String(n).padStart(2, "0");
}

function formatDate(d) {
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) +
        " " + WEEKDAYS[d.getDay()];
}

function formatClock(d) {
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) +
        ":" + pad2(d.getSeconds());
}

function dayKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) +
        "-" + pad2(d.getDate());
}

function isOn(value) {
    return Number(value) === 1;
}

function stateEmojis(snapshot) {
    return STATE_KEYS
        .map(state => (isOn(snapshot[state.key]) ? state.on : state.off))
        .join(" ");
}

// Vetor dos estados (ex.: "1100") usado para detectar transições.
function stateVector(snapshot) {
    return STATE_KEYS
        .map(state => (isOn(snapshot[state.key]) ? "1" : "0"))
        .join("");
}

function renderMessage(text) {
    const seqEl = container.querySelector("#sequence");

    if (seqEl) {
        seqEl.innerHTML =
            '<div class="seq-empty">' + text + "</div>";
    }
}

function renderSequence(snapshots) {
    const seqEl = container.querySelector("#sequence");

    if (!seqEl) {
        return;
    }

    if (!snapshots || !snapshots.length) {
        currentSnapshots = [];
        renderMessage("Sem dados no período.");
        return;
    }

    currentSnapshots = snapshots.slice(0, MAX_ROWS);

    let lastDay = null;
    let html = "";

    snapshots.slice(0, MAX_ROWS).forEach(snapshot => {
        const d = new Date(snapshot.ts);
        const dk = dayKey(d);
        const showDate = dk !== lastDay;

        lastDay = dk;

        html +=
            '<div class="seq-row">' +
            '<span class="seq-date">' +
            (showDate ? formatDate(d) : "") +
            "</span>" +
            '<span class="seq-clock">' +
            formatClock(d) +
            "</span>" +
            '<span class="seq-states">' +
            stateEmojis(snapshot) +
            "</span>" +
            "</div>";
    });

    seqEl.innerHTML = html;
}

// ============================================================
// FONTE DOS DADOS
// ------------------------------------------------------------
// Assunção: os quatro estados são timeseries publicadas juntas,
// no mesmo ts. Lê o histórico pela API de telemetria.
// ============================================================

function fetchHistory() {
    const now = Date.now();
    const startTs = now - HISTORY_WINDOW_MS;
    const keys = STATE_KEYS.map(state => state.key).join(",");

    const url =
        "/api/plugins/telemetry/DEVICE/" + DEVICE_MONITORA_DG +
        "/values/timeseries" +
        "?keys=" + encodeURIComponent(keys) +
        "&startTs=" + startTs +
        "&endTs=" + now +
        "&limit=" + HISTORY_LIMIT +
        "&orderBy=DESC";

    return new Promise((resolve, reject) => {
        ctx.http.get(url).subscribe(
            response => resolve(response || {}),
            error => reject(error)
        );
    });
}

function buildSnapshots(byKey) {
    const byTs = new Map();

    STATE_KEYS.forEach(state => {
        const points = (byKey && byKey[state.key]) || [];

        points.forEach(point => {
            const ts = Number(point.ts);

            if (!Number.isFinite(ts)) {
                return;
            }

            if (!byTs.has(ts)) {
                byTs.set(ts, {});
            }

            byTs.get(ts)[state.key] = point.value;
        });
    });

    const timestamps =
        Array.from(byTs.keys()).sort((a, b) => a - b);

    const current = {};
    const snapshots = [];

    timestamps.forEach(ts => {
        Object.assign(current, byTs.get(ts));

        const snapshot = { ts };

        STATE_KEYS.forEach(state => {
            snapshot[state.key] = current[state.key];
        });

        snapshots.push(snapshot);
    });

    // Ordem: do evento mais recente para o mais antigo.
    snapshots.reverse();

    return snapshots;
}

function loadSequence() {
    renderMessage("Carregando...");

    fetchHistory()
        .then(byKey => {
            renderSequence(buildSnapshots(byKey));
            startLiveSubscription();
        })
        .catch(error => {
            console.error("Monitora_DG histórico:", error);
            renderMessage("Não foi possível carregar o histórico.");
        });
}

// ============================================================
// ATUALIZAÇÃO AO VIVO
// ------------------------------------------------------------
// Escuta os quatro estados via subscription do ThingsBoard e
// acrescenta uma nova linha no topo quando uma transição de
// estado é detectada. Valores repetidos (sem transição) e
// timestamps já conhecidos são ignorados.
// ============================================================

function applyLiveSnapshot(candidate) {
    if (!candidate || !Number.isFinite(candidate.ts)) {
        return;
    }

    // Histórico ainda não carregou.
    if (!currentSnapshots) {
        return;
    }

    // Timestamp já conhecido (ou mais antigo): não é novidade.
    if (
        currentSnapshots.length &&
        candidate.ts <= currentSnapshots[0].ts
    ) {
        return;
    }

    // Mesmo estado do topo: não houve transição.
    if (
        currentSnapshots.length &&
        stateVector(candidate) === stateVector(currentSnapshots[0])
    ) {
        return;
    }

    currentSnapshots.unshift(candidate);

    if (currentSnapshots.length > MAX_ROWS) {
        currentSnapshots.length = MAX_ROWS;
    }

    renderSequence(currentSnapshots);
}

function applyLiveData(data) {
    const values = {};
    let maxTs = null;

    STATE_KEYS.forEach(state => {
        const item = data.find(d =>
            d.dataKey &&
            d.dataKey.name === state.key &&
            d.dataKey.type === "timeseries" &&
            d.datasource &&
            d.datasource.entityFilter &&
            d.datasource.entityFilter.singleEntity &&
            d.datasource.entityFilter.singleEntity.id === DEVICE_MONITORA_DG
        );

        if (!item || !item.data || !item.data.length) {
            return;
        }

        const point = item.data[item.data.length - 1];
        const ts = Number(point[0]);

        if (!Number.isFinite(ts)) {
            return;
        }

        values[state.key] = point[1];

        if (maxTs === null || ts > maxTs) {
            maxTs = ts;
        }
    });

    // Só monta o snapshot quando os quatro estados estão presentes.
    if (maxTs === null || Object.keys(values).length < STATE_KEYS.length) {
        return;
    }

    const candidate = { ts: maxTs };

    STATE_KEYS.forEach(state => {
        candidate[state.key] = values[state.key];
    });

    applyLiveSnapshot(candidate);
}

function startLiveSubscription() {
    const subscriptionOptions = {
        type: "latest",

        datasources: [{
            type: "entity",

            entityFilter: {
                type: "singleEntity",
                singleEntity: {
                    entityType: "DEVICE",
                    id: DEVICE_MONITORA_DG
                }
            },

            dataKeys: STATE_KEYS.map(state => ({
                type: "timeseries",
                name: state.key,
                settings: {}
            }))
        }],

        callbacks: {
            onDataUpdated: subscription =>
                applyLiveData(subscription.data || [])
        }
    };

    ctx.subscriptionApi
        .createSubscription(subscriptionOptions, true)
        .subscribe(subscription => {
            ctx.defaultSubscription = subscription;
        });
}

// ============================================================
// LIMPEZA
// ============================================================

ctx.registerDestroyCallback(() => {
    currentSnapshots = null;
});

loadSequence();
