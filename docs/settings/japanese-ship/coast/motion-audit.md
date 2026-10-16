# Motion and registration audit

| Element | World placement / motion | Phase / weather | Reduced motion |
| --- | --- | --- | --- |
| Coast landmarks, shore foam, moored boats and torii | One transparent 2,880 × 184 strip, top 20; rightward 2.4 px/s on `voyage`, 1,200-second lap | Six registered phase images | Lite runs; still holds first frame at zero drift |
| Village, pagoda, castle and shrine lights | Same period, top, span and drift as the coast; three 700 ms brightness frames | Only the night phase has nonblank light frames; normal phase easing applies | Lite runs; still selects the first night light frame |
| Coast storm shading | Same coast mask, period, top, span and drift | Existing storm curve, reaching 0.5 alpha at peak | Lite retains weather; still uses calm weather |
| Umibozu | Three 72-pixel open-water berths at x=370, 1330, 2290; same coast drift; world surface y=178 | All 15 approved 500 ms poses on `swell`; neighbours offset five poses; body full-strength above 78% storm | Hidden in lite and still/reduced motion |
| Sea, wake, stars, moon, sky and weather fill | Parent definitions and images unchanged, verified by audit | Parent six phases, weather and water clocks unchanged | Parent policies unchanged |
| Ship, crew, suggestion shark and dragon departure | Parent stage, cast, interaction and departure contracts unchanged | Ship-bound effects retain their water clock and surface split | Parent policies unchanged |

The voyage channel is 1 at every atmosphere intensity and in delivered weather.
Storms change the sea and spirit's animation without changing the coast lap or
separating the boats, windows, shading or spirit berths from their shoreline.
The shared span is [-4096, 4608]. Both strip boundaries are transparent; neither
the coast nor spirit is a viewport fill. Independent inherited sky/sea/weather
layers cover the taller visible world beyond the scene.

The exact original opaque spirit pixels, including eyes, foam, rise and submerged
poses, survive atlas registration. The native full-motion storm samples find peak
opaque-body counts of 5,290 (wide), 1,708 (tall) and 4,137 (square), and a fully
submerged zero in each cycle. The matching lite samples are all zero. See
`evidence/results.json`; the observer counts source body colours in actual canvas
PNGs, without renderer instrumentation.

The ten-second native clip uses the shipped 2.4 px/s. The three full-lap review
clips use a cloned RPC fixture at exactly 144 px/s. The fixture asserts its served
speed before drawing; it never modifies the pack or its cached server object.
Only voyage drift is accelerated, so lights, waves, rise/settle and weather still
animate at native speed. The phase captures and 192 crew clicks use the shipped
manifest without the acceleration override.
