# Monitora_DG — Widget HISTÓRICO / SEQUÊNCIA DE ESTADOS

Projeto local **independente** do widget `ENERGIA DO SÍTIO` (widget_1), com a
mesma identidade visual.

## Especificação

Tabela histórica da sequência de estados do snapshot do device
`7e62cc00-c0df-11f1-8ef7-dd61fc2d324e`.

1. **Sem** qualquer informação/classificação de automático/manual. Não usar
   `source`, `reason` ou qualquer inferência desse tipo.
2. Colunas (nesta ordem): `rede_disponivel`, `alimentacao_rede`,
   `alimentacao_offgrid`, `alimentacao_gerador`.
3. Ordenação por `ts` **decrescente** (evento mais recente primeiro).
4. Data/hora no formato `dd/mm ddd HH:mm:ss` (ex.: `07/10 qua 10:27:05`).
5. A data (`dd/mm ddd`) aparece **somente** na primeira linha de cada dia; nas
   demais linhas do mesmo dia mostra-se apenas `HH:mm:ss`.
6. Código visual **idêntico** ao widget ENERGIA DO SÍTIO:
   - `rede_disponivel` → 🟢 / ⚪
   - `alimentacao_rede` → 🔵 / ⚪
   - `alimentacao_offgrid` → 🟡 / ⚪
   - `alimentacao_gerador` → 🔴 / ⚪
7. Sem coluna de automático/manual.
8. Não altera o firmware nem a estrutura dos dados históricos existentes.
9. Primeira versão: prioriza a tabela histórica ordenada e agrupada por data.
   Não implementa duração de estado.
10. Widget independente do ENERGIA DO SÍTIO, seguindo a mesma identidade visual.

## Arquivos

- `index.html` — estrutura HTML da tabela.
- `style.css` — apresentação visual (identidade do widget_1).
- `script.js` — leitura do histórico, montagem e ordenação dos snapshots.
- `preview.html` — ambiente local de teste (dados simulados); não é o widget publicado.

## Fonte dos dados (assunção)

Interpretação assumida nesta primeira versão (não há especificação-base no
projeto):

- O "snapshot" = os **quatro estados publicados juntos**, no mesmo `ts`, como
  **timeseries**.
- O widget lê o histórico via `ctx.http.get`:
  `/api/plugins/telemetry/DEVICE/<id>/values/timeseries?keys=...&startTs=...&endTs=...&limit=...&orderBy=DESC`.
- Cada `ts` distinto vira uma linha (snapshot); o valor de cada estado é mantido
  até a próxima mudança.

A fonte está isolada em `script.js` (constantes e função `fetchHistory`), para
trocá-la facilmente caso a estrutura real seja outra (ex.: um atributo JSON).

## Regra de trabalho

Alterações pequenas, controladas e verificáveis; preservar o comportamento
existente; testar no `preview.html` antes de publicar no ThingsBoard.
