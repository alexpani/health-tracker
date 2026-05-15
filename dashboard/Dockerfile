# Dashboard image: solo nginx + bundle gia' costruito.
#
# Il build (vite + tsc) e' fatto host-side prima dello scp/build perche':
# 1. La LXC ealth-dashboard ha 1GB di RAM e vite/rollup OOM-killano sotto
#    questo limite (chunk transform + minify combinati richiedono ~1.5GB).
# 2. Tenere il build esterno al container evita di shippare node_modules
#    + tutto il toolchain TS dentro l'immagine prod.
#
# Deploy workflow (vedi `scripts/deploy-dashboard.sh`):
#   1. cd dashboard && VITE_API_URL=... npm run build       # host-side
#   2. scp dist/ + Dockerfile + nginx.conf + docker-compose.yml → LXC
#   3. ssh LXC: docker compose up -d --build
#
# Se in futuro la LXC viene scalata sopra ~2GB o switchata a build remoto,
# basta ripristinare lo stage `node:20-alpine` + `npm run build`. Il vecchio
# Dockerfile multi-stage e' visibile in git history (commit ac5ee19 e
# precedenti).
FROM nginx:alpine
COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
