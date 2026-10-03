/**
 * Estados de carga con la forma de lo que va a llegar (tarjetas, tabla,
 * gráfico) en vez de un "Cargando…": la página no salta cuando llegan los
 * datos y se nota qué se está esperando. El brillo es CSS (.sk en
 * styles.css) y respeta prefers-reduced-motion.
 */
const barra = (ancho, alto = 12) => '<i class="sk" style="width:' + ancho + ';height:' + alto + 'px"></i>';

export const esqueletoKpis = (n = 4) => '<div class="kpis sk-kpis" aria-busy="true" aria-label="Cargando indicadores">'
  + Array.from({ length: n }, () => '<div class="kpi">' + barra('55%', 26) + barra('70%') + barra('45%', 10) + '</div>').join('') + '</div>';

export const esqueletoTabla = (filas = 6, cols = 5) => '<div class="table-wrap sk-tabla" data-sin-barra aria-busy="true" aria-label="Cargando tabla"><table><thead><tr>'
  + Array.from({ length: cols }, () => '<th>' + barra('60%', 10) + '</th>').join('') + '</tr></thead><tbody>'
  + Array.from({ length: filas }, () => '<tr>' + Array.from({ length: cols }, (_, i) => '<td>' + barra((i === 1 ? 80 : 45 + (i * 7) % 30) + '%') + '</td>').join('') + '</tr>').join('')
  + '</tbody></table></div>';

export const esqueletoGrafico = (alto = 180) => '<div class="sk-grafico" aria-busy="true" aria-label="Cargando gráfico" style="height:' + alto + 'px">'
  + [62, 40, 78, 55, 90, 48, 70, 35].map(h => '<i class="sk" style="height:' + h + '%"></i>').join('') + '</div>';

export const esqueletoPanel = () => '<div class="panel">' + barra('30%', 16) + barra('50%', 10) + esqueletoGrafico(150) + '</div>';
