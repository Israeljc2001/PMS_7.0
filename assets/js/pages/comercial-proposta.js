// Gerador de proposta comercial PPT a partir de PDF de orcamento.
(function () {
    const scriptUrl = document.currentScript && document.currentScript.src
        ? document.currentScript.src
        : window.location.href;
    const assetBaseUrl = new URL('../../', scriptUrl);

    const state = {
        file: null,
        templateFile: null,
        parsed: null,
        pdfjs: null
    };

    function assetUrl(path) {
        return new URL(path, assetBaseUrl).href;
    }

    function getCurrentSeller() {
        try {
            const sessao = JSON.parse(localStorage.getItem('sinaliza_sessao') || '{}');
            return sessao.username || '';
        } catch (e) {
            return '';
        }
    }

    function escapeText(value) {
        return String(value || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function cleanLine(line) {
        return String(line || '')
            .replace(/\s{2,}/g, ' ')
            .replace(/^\W+|\W+$/g, '')
            .trim();
    }

    function parseMoney(value) {
        if (!value) return null;
        const normalized = String(value)
            .replace(/[^\d,.-]/g, '')
            .replace(/\.(?=\d{3}(?:\D|$))/g, '')
            .replace(',', '.');
        const parsed = parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function formatCurrency(value) {
        if (!Number.isFinite(value)) return '--';
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    }

    function firstMatch(text, patterns, fallback = '') {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) return cleanLine(match[1]);
        }
        return fallback;
    }

    async function loadPdfJs() {
        if (state.pdfjs) return state.pdfjs;

        let pdfjs;
        let workerSrc = assetUrl('vendor/pdfjs/pdf.worker.min.mjs');

        try {
            pdfjs = await import(assetUrl('vendor/pdfjs/pdf.min.mjs'));
        } catch (error) {
            console.warn('PDF.js local indisponivel, tentando CDN.', error);
            workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
            pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
        }

        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        state.pdfjs = pdfjs;
        return pdfjs;
    }

    async function extractPdfText(file) {
        const pdfjs = await loadPdfJs();
        const data = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data }).promise;
        const pages = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            const items = content.items
                .map(item => ({
                    text: String(item.str || '').trim(),
                    x: item.transform ? item.transform[4] : 0,
                    y: item.transform ? item.transform[5] : 0
                }))
                .filter(item => item.text);

            items.sort((a, b) => {
                const yDiff = Math.round(b.y) - Math.round(a.y);
                return Math.abs(yDiff) > 2 ? yDiff : a.x - b.x;
            });

            const lines = [];
            let currentLine = [];
            let currentY = null;

            items.forEach(item => {
                if (currentY === null || Math.abs(item.y - currentY) <= 3) {
                    currentLine.push(item.text);
                } else {
                    lines.push(currentLine.join(' '));
                    currentLine = [item.text];
                }
                currentY = item.y;
            });

            if (currentLine.length) lines.push(currentLine.join(' '));
            pages.push(lines.join('\n'));
        }

        return pages.join('\n\n');
    }

    function extractItems(lines) {
        const moneyPattern = /(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g;
        const ignored = /(total|subtotal|desconto|frete|ipi|icms|valor\s+total|condi[cç][aã]o|pagamento|validade|cnpj|telefone|e-mail|email)/i;
        const items = [];

        lines.forEach(rawLine => {
            const line = cleanLine(rawLine);
            if (!line || ignored.test(line)) return;

            const values = line.match(moneyPattern);
            if (!values || values.length === 0) return;

            const total = parseMoney(values[values.length - 1]);
            if (!Number.isFinite(total) || total <= 0) return;

            let description = line.replace(moneyPattern, ' ').replace(/\s{2,}/g, ' ').trim();
            description = description.replace(/^\d+\s+/, '').replace(/\b(un|und|unid|pc|pcs|p[cç]s)\b/ig, '').trim();

            const qtyMatch = line.match(/(?:^|\s)(\d+(?:[,.]\d+)?)\s*(?:un|und|unid|pc|pcs|p[cç]s)?\b/i);
            const quantity = qtyMatch ? parseMoney(qtyMatch[1]) : 1;

            if (!description || description.length < 4) description = `Item ${items.length + 1}`;

            items.push({
                description: description.substring(0, 120),
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
                total
            });
        });

        return items.slice(0, 40);
    }

    function parseBudgetText(text, fileName) {
        const normalized = String(text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ');
        const lines = normalized.split('\n').map(cleanLine).filter(Boolean);
        const joined = lines.join('\n');
        const flat = lines.join(' ');
        const defaultValidity = document.getElementById('proposal-default-validity')?.value || '7 dias';

        const budgetNumber = firstMatch(flat, [
            /ORC[_\s-]*(\d{3,})/i,
            /or[cç]amento\s*(?:n[ºo.]*)?\s*[:#-]?\s*(\d{3,})/i,
            /proposta\s*(?:n[ºo.]*)?\s*[:#-]?\s*(\d{3,})/i
        ], (fileName.match(/(\d{3,})/) || [,''])[1]);

        const client = firstMatch(joined, [
            /(?:cliente|raz[aã]o social|empresa)\s*[:#-]\s*([^\n]+)/i,
            /(?:aos cuidados de|contato)\s*[:#-]\s*([^\n]+)/i
        ], 'Cliente');

        const cnpj = firstMatch(flat, [
            /\b(CNPJ\s*[:#-]?\s*\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/i,
            /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})\b/
        ]);

        const email = firstMatch(flat, [/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i]);
        const issueDate = firstMatch(flat, [
            /(?:emiss[aã]o|data)\s*[:#-]?\s*(\d{2}\/\d{2}\/\d{4})/i,
            /(\d{2}\/\d{2}\/\d{4})/
        ], new Date().toLocaleDateString('pt-BR'));

        const validity = firstMatch(flat, [/validade\s*[:#-]?\s*([^.|\n]{3,35})/i], defaultValidity);
        const payment = firstMatch(flat, [/(?:condi[cç][aã]o de pagamento|pagamento)\s*[:#-]?\s*([^.|\n]{3,80})/i], 'Conforme alinhamento comercial');
        const shipping = firstMatch(flat, [/(?:frete|transporte)\s*[:#-]?\s*([^.|\n]{3,80})/i], 'Conforme orcamento');
        const delivery = firstMatch(flat, [/(?:prazo de entrega|entrega)\s*[:#-]?\s*([^.|\n]{3,80})/i], 'A combinar apos aprovacao');

        const labeledTotal = parseMoney(firstMatch(flat, [/(?:valor total|total geral|total do or[cç]amento|total)\D{0,20}((?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2})/i]));
        const moneyValues = [...flat.matchAll(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g)]
            .map(match => parseMoney(match[0]))
            .filter(value => Number.isFinite(value));
        const total = Number.isFinite(labeledTotal) ? labeledTotal : (moneyValues.length ? Math.max(...moneyValues) : null);
        let items = extractItems(lines);

        if (items.length === 0 && Number.isFinite(total)) {
            items = [{ description: `Orcamento ${budgetNumber || fileName || ''}`.trim(), quantity: 1, total }];
        }

        return { budgetNumber, client, cnpj, email, issueDate, validity, payment, shipping, delivery, total, items, rawText: normalized };
    }

    async function imageAsDataUri(src) {
        try {
            const response = await fetch(src);
            if (!response.ok) return '';
            const blob = await response.blob();
            return await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => resolve('');
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            return '';
        }
    }

    function safeFileName(value) {
        return String(value || 'cliente')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/gi, '_')
            .replace(/^_+|_+$/g, '')
            .substring(0, 40) || 'cliente';
    }

    function getJSZip() {
        const JSZipCtor = window.JSZip || (window.pptxgen && window.pptxgen.JSZip);
        if (!JSZipCtor) throw new Error('Biblioteca JSZip local nao carregada para editar o PPTX modelo.');
        return JSZipCtor;
    }

    function parseXml(xml) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const error = doc.getElementsByTagName('parsererror')[0];
        if (error) throw new Error('Nao foi possivel ler a estrutura XML do PPTX modelo.');
        return doc;
    }

    function serializeXml(doc) {
        return new XMLSerializer().serializeToString(doc);
    }

    function xmlNodes(root, localName) {
        return Array.from(root.getElementsByTagName('*')).filter(node => node.localName === localName);
    }

    function attr(node, name, namespace) {
        return namespace ? node.getAttributeNS(namespace, name) : node.getAttribute(name);
    }

    function normalizeZipPath(basePath, target) {
        if (!target) return '';
        if (target.startsWith('/')) return target.slice(1);
        const parts = `${basePath.slice(0, basePath.lastIndexOf('/') + 1)}${target}`.split('/');
        const clean = [];
        parts.forEach(part => {
            if (!part || part === '.') return;
            if (part === '..') clean.pop();
            else clean.push(part);
        });
        return clean.join('/');
    }

    function sortedSlidePaths(zip) {
        return Object.keys(zip.files)
            .filter(path => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
            .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)[1]) - Number(b.match(/slide(\d+)\.xml/i)[1]));
    }

    async function getLastSlidePath(zip) {
        const presentationPath = 'ppt/presentation.xml';
        const relsPath = 'ppt/_rels/presentation.xml.rels';
        const fallback = sortedSlidePaths(zip);

        if (!zip.file(presentationPath) || !zip.file(relsPath)) {
            return fallback[fallback.length - 1];
        }

        const presentationDoc = parseXml(await zip.file(presentationPath).async('string'));
        const slideIds = xmlNodes(presentationDoc, 'sldId');
        const lastSlideId = slideIds[slideIds.length - 1];
        const lastRelId = lastSlideId && (attr(lastSlideId, 'id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships') || lastSlideId.getAttribute('r:id'));

        if (!lastRelId) return fallback[fallback.length - 1];

        const relsDoc = parseXml(await zip.file(relsPath).async('string'));
        const rel = xmlNodes(relsDoc, 'Relationship').find(node => node.getAttribute('Id') === lastRelId);
        const target = rel && rel.getAttribute('Target');
        const slidePath = normalizeZipPath(presentationPath, target);

        return zip.file(slidePath) ? slidePath : fallback[fallback.length - 1];
    }

    function nextRelationshipId(relsDoc) {
        const ids = xmlNodes(relsDoc, 'Relationship')
            .map(node => Number((node.getAttribute('Id') || '').replace(/^rId/i, '')))
            .filter(Number.isFinite);
        return `rId${ids.length ? Math.max(...ids) + 1 : 1}`;
    }

    function nextShapeId(slideDoc) {
        const ids = xmlNodes(slideDoc, 'cNvPr')
            .map(node => Number(node.getAttribute('id')))
            .filter(Number.isFinite);
        return ids.length ? Math.max(...ids) + 1 : 1000;
    }

    function dataUriToUint8Array(dataUri) {
        const base64 = String(dataUri).split(',')[1] || '';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    async function renderPdfPageImages(file, maxPages = 4) {
        const pdfjs = await loadPdfJs();
        const data = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data }).promise;
        const pageImages = [];
        const pageCount = Math.min(pdf.numPages, maxPages);

        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.55 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            pageImages.push({ dataUri: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, pageNum });
        }

        return { pageImages, totalPages: pdf.numPages };
    }

    function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
        const words = String(text || '--').replace(/\s+/g, ' ').trim().split(' ');
        const lines = [];
        let line = '';

        words.forEach(word => {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        });
        if (line) lines.push(line);

        const visible = lines.slice(0, maxLines);
        if (lines.length > maxLines && visible.length) {
            visible[visible.length - 1] = `${visible[visible.length - 1].replace(/\s+\S*$/, '')}...`;
        }

        visible.forEach((visibleLine, index) => ctx.fillText(visibleLine, x, y + (index * lineHeight)));
        return visible.length * lineHeight;
    }

    function drawFittedText(ctx, text, x, y, maxWidth, minFontSize = 12) {
        const originalFont = ctx.font;
        const match = originalFont.match(/(\d+(?:\.\d+)?)px/);
        let fontSize = match ? Number(match[1]) : 16;
        let output = String(text || '--').replace(/\s+/g, ' ').trim();

        while (ctx.measureText(output).width > maxWidth && fontSize > minFontSize) {
            fontSize -= 1;
            ctx.font = originalFont.replace(/(\d+(?:\.\d+)?)px/, `${fontSize}px`);
        }

        while (ctx.measureText(output).width > maxWidth && output.length > 4) {
            output = `${output.slice(0, -4).trim()}...`;
        }

        ctx.fillText(output, x, y);
        ctx.font = originalFont;
    }

    function drawCard(ctx, x, y, w, h, radius, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    function drawPdfImage(ctx, image, boxX, boxY, boxW, boxH, pageLabel) {
        ctx.fillStyle = '#0b4ea2';
        ctx.font = '700 18px Arial';
        ctx.fillText(pageLabel, boxX, boxY - 12);

        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#d0d8e6';
        ctx.lineWidth = 2;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.beginPath();
        ctx.rect(boxX + 8, boxY + 8, boxW - 16, boxH - 16);
        ctx.clip();

        const scale = Math.min((boxW - 16) / image.width, (boxH - 16) / image.height);
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        const drawX = boxX + ((boxW - drawW) / 2);
        const drawY = boxY + ((boxH - drawH) / 2);
        ctx.drawImage(image, drawX, drawY, drawW, drawH);
        ctx.restore();
    }

    async function buildLastSlideOverlay(data, pdfRender, logoDataUri, seller) {
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#0057a8';
        ctx.fillRect(0, 0, 86, canvas.height);
        ctx.fillStyle = '#ff7900';
        ctx.beginPath();
        ctx.moveTo(50, 0);
        ctx.lineTo(118, 0);
        ctx.lineTo(94, canvas.height);
        ctx.lineTo(25, canvas.height);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f8fbff';
        ctx.beginPath();
        ctx.moveTo(105, 0);
        ctx.lineTo(690, 0);
        ctx.lineTo(600, canvas.height);
        ctx.lineTo(135, canvas.height);
        ctx.closePath();
        ctx.fill();

        if (logoDataUri) {
            try {
                const logo = await loadImage(logoDataUri);
                ctx.drawImage(logo, 120, 70, 170, 74);
            } catch (e) {
                ctx.fillStyle = '#0057a8';
                ctx.font = '900 52px Arial';
                ctx.fillText('J7S', 130, 125);
            }
        }

        ctx.fillStyle = '#0057a8';
        ctx.font = '900 58px Arial';
        ctx.fillText('PROPOSTA', 260, 110);
        ctx.fillStyle = '#ff7900';
        ctx.font = '900 56px Arial';
        ctx.fillText('COMERCIAL', 260, 176);
        ctx.fillStyle = '#14213d';
        ctx.font = '700 21px Arial';
        drawFittedText(ctx, 'Orcamento enquadrado na solucao completa J7S', 263, 220, 385, 17);

        drawCard(ctx, 108, 250, 520, 314, 10, '#ffffff', '#95b8e8');
        const info = [
            ['Orcamento no', data.budgetNumber || '--'],
            ['Cliente', data.client || 'Cliente'],
            ['Emissao', data.issueDate || '--'],
            ['Pagamento', data.payment || '--'],
            ['Frete', data.shipping || '--'],
            ['Validade da proposta', data.validity || '--']
        ];
        info.forEach((row, index) => {
            const y = 294 + (index * 39);
            ctx.fillStyle = '#0057a8';
            ctx.font = '700 19px Arial';
            drawFittedText(ctx, row[0], 146, y, 190, 16);
            ctx.fillStyle = '#1d2b48';
            ctx.font = '700 20px Arial';
            drawFittedText(ctx, row[1], 360, y, 235, 14);
            ctx.strokeStyle = '#d6deea';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(140, y + 15);
            ctx.lineTo(603, y + 15);
            ctx.stroke();
        });

        ctx.fillStyle = '#0057a8';
        ctx.fillRect(108, 514, 520, 50);
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 22px Arial';
        ctx.fillText('Valor total liq. com IPI:', 136, 548);
        ctx.font = '900 29px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(formatCurrency(data.total), 600, 548);
        ctx.textAlign = 'left';

        drawCard(ctx, 115, 588, 500, 242, 10, '#ffffff', '#9ec1ed');
        ctx.fillStyle = '#0057a8';
        ctx.font = '900 24px Arial';
        drawFittedText(ctx, 'VALOR AGREGADO A LONGO PRAZO', 150, 640, 430, 18);
        const bullets = [
            'Placas normatizadas conforme CONTRAN e ABNT',
            'Fabricacao propria com controle total de qualidade',
            'Materiais de alta durabilidade',
            'Reducao de retrabalho e custo operacional',
            '5 anos de garantia, gerando seguranca e previsibilidade'
        ];
        ctx.font = '500 18px Arial';
        bullets.forEach((bullet, index) => {
            const y = 681 + (index * 28);
            ctx.fillStyle = '#ff7900';
            ctx.fillText('>', 138, y);
            ctx.fillStyle = '#1f2a44';
            drawWrappedText(ctx, bullet, 165, y, 395, 21, 1);
        });

        drawCard(ctx, 120, 850, 486, 80, 10, '#0057a8', '#0057a8');
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 26px Arial';
        drawFittedText(ctx, 'INVESTIMENTO INTELIGENTE', 190, 895, 350, 19);
        ctx.font = '700 14px Arial';
        drawFittedText(ctx, `Responsavel comercial: ${seller}`, 190, 920, 350, 11);

        const pdfImages = await Promise.all(pdfRender.pageImages.map(page => loadImage(page.dataUri)));
        const pageArea = { x: 735, y: 70, w: 1130, h: 850 };
        drawCard(ctx, pageArea.x - 18, pageArea.y - 38, pageArea.w + 36, pageArea.h + 64, 14, '#ffffff', '#0057a8');
        const gap = 34;
        const cellW = (pageArea.w - gap) / 2;
        const cellH = (pageArea.h - gap) / 2;
        pdfImages.forEach((image, index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const x = pageArea.x + (col * (cellW + gap));
            const y = pageArea.y + (row * (cellH + gap));
            drawPdfImage(ctx, image, x, y, cellW, cellH, `Pagina ${pdfRender.pageImages[index].pageNum}`);
        });

        if (pdfRender.totalPages > 4) {
            ctx.fillStyle = '#1d2b48';
            ctx.font = '700 18px Arial';
            ctx.fillText(`PDF com ${pdfRender.totalPages} paginas. Exibindo as 4 primeiras.`, pageArea.x, 952);
        }

        ctx.fillStyle = '#0057a8';
        ctx.fillRect(0, 985, 1330, 95);
        ctx.fillStyle = '#ff7900';
        ctx.beginPath();
        ctx.moveTo(1330, 985);
        ctx.lineTo(1920, 985);
        ctx.lineTo(1920, 1080);
        ctx.lineTo(1270, 1080);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 19px Arial';
        drawFittedText(ctx, 'NORMATIZADAS CONTRAN E ABNT', 190, 1042, 275, 15);
        drawFittedText(ctx, 'FABRICACAO PROPRIA', 520, 1042, 230, 15);
        drawFittedText(ctx, '5 ANOS DE GARANTIA', 835, 1042, 250, 15);
        ctx.font = '900 24px Arial';
        drawFittedText(ctx, 'QUALIDADE QUE SALVA VIDAS.', 1380, 1030, 470, 18);
        drawFittedText(ctx, 'ECONOMIA QUE SE PERCEBE NO LONGO PRAZO.', 1380, 1062, 470, 18);

        return canvas.toDataURL('image/png');
    }

    function addPngDefault(contentTypesDoc) {
        const typesNs = 'http://schemas.openxmlformats.org/package/2006/content-types';
        const hasPng = xmlNodes(contentTypesDoc, 'Default')
            .some(node => String(node.getAttribute('Extension') || '').toLowerCase() === 'png');
        if (hasPng) return;
        const root = contentTypesDoc.documentElement;
        const node = contentTypesDoc.createElementNS(typesNs, 'Default');
        node.setAttribute('Extension', 'png');
        node.setAttribute('ContentType', 'image/png');
        root.insertBefore(node, root.firstChild);
    }

    function createEmptyRelsDoc() {
        return parseXml('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    }

    async function insertOverlayOnLastSlide(templateFile, overlayDataUri) {
        const JSZipCtor = getJSZip();
        const zip = await JSZipCtor.loadAsync(await templateFile.arrayBuffer());
        const slidePaths = sortedSlidePaths(zip);
        if (slidePaths.length < 6) throw new Error('O PPTX modelo precisa ter pelo menos 6 slides para preservar os 5 primeiros e atualizar a ultima pagina.');

        const slidePath = await getLastSlidePath(zip);
        if (!slidePath) throw new Error('Nao encontrei o ultimo slide dentro do PPTX modelo.');

        const presentationDoc = zip.file('ppt/presentation.xml')
            ? parseXml(await zip.file('ppt/presentation.xml').async('string'))
            : null;
        const slideSize = presentationDoc && xmlNodes(presentationDoc, 'sldSz')[0];
        const slideCx = slideSize ? Number(slideSize.getAttribute('cx')) : 12192000;
        const slideCy = slideSize ? Number(slideSize.getAttribute('cy')) : 6858000;

        const slideDoc = parseXml(await zip.file(slidePath).async('string'));
        const spTree = xmlNodes(slideDoc, 'spTree')[0];
        if (!spTree) throw new Error('O ultimo slide do PPTX modelo nao tem uma arvore de objetos valida.');

        xmlNodes(slideDoc, 'pic').forEach(pic => {
            const cNvPr = xmlNodes(pic, 'cNvPr')[0];
            if (cNvPr && cNvPr.getAttribute('name') === 'J7S_PDF_OVERLAY') {
                pic.parentNode.removeChild(pic);
            }
        });

        const relsPath = slidePath.replace('/slides/', '/slides/_rels/') + '.rels';
        const relsDoc = zip.file(relsPath)
            ? parseXml(await zip.file(relsPath).async('string'))
            : createEmptyRelsDoc();
        const relId = nextRelationshipId(relsDoc);
        const mediaName = `j7s_proposta_overlay_${Date.now()}.png`;

        const rel = relsDoc.createElementNS('http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship');
        rel.setAttribute('Id', relId);
        rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
        rel.setAttribute('Target', `../media/${mediaName}`);
        relsDoc.documentElement.appendChild(rel);

        const picId = nextShapeId(slideDoc);
        const picXml = `<p:pic xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:nvPicPr><p:cNvPr id="${picId}" name="J7S_PDF_OVERLAY"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${slideCx}" cy="${slideCy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
        const picDoc = parseXml(picXml);
        spTree.appendChild(slideDoc.importNode(picDoc.documentElement, true));

        const contentTypesDoc = parseXml(await zip.file('[Content_Types].xml').async('string'));
        addPngDefault(contentTypesDoc);

        zip.file(slidePath, serializeXml(slideDoc));
        zip.file(relsPath, serializeXml(relsDoc));
        zip.file('[Content_Types].xml', serializeXml(contentTypesDoc));
        zip.file(`ppt/media/${mediaName}`, dataUriToUint8Array(overlayDataUri));

        return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1200);
    }

    async function buildPptx(data) {
        const logoDataUri = await imageAsDataUri(assetUrl('img/logo.png'));
        const seller = document.getElementById('proposal-salesperson')?.value?.trim() || getCurrentSeller() || 'Comercial J7S';
        const pdfRender = await renderPdfPageImages(state.file, 4);
        const overlayDataUri = await buildLastSlideOverlay(data, pdfRender, logoDataUri, seller);
        const blob = await insertOverlayOnLastSlide(state.templateFile, overlayDataUri);
        const fileName = `Proposta_Comercial_${data.budgetNumber || 'orcamento'}_${safeFileName(data.client)}.pptx`;
        downloadBlob(blob, fileName);
        return fileName;
    }

    window.handleProposalPdfSelection = function (event) {
        const file = event.target.files && event.target.files[0];
        const label = document.getElementById('proposal-file-label');
        const result = document.getElementById('proposal-result');
        const seller = document.getElementById('proposal-salesperson');

        state.file = file || null;
        state.parsed = null;

        if (label) label.innerText = file ? file.name : 'Selecionar PDF do orcamento';
        if (seller && !seller.value) seller.value = getCurrentSeller();
        if (result) {
            result.style.display = file ? 'block' : 'none';
            result.style.borderLeftColor = file ? 'var(--cor-primaria)' : 'var(--cor-alerta)';
            result.innerHTML = file
                ? `PDF carregado.${state.templateFile ? ' Clique em <strong>Gerar Proposta PPT</strong>.' : ' Agora selecione o <strong>PPTX modelo</strong>.'}`
                : '';
        }
    };

    window.handleProposalTemplateSelection = function (event) {
        const file = event.target.files && event.target.files[0];
        const label = document.getElementById('proposal-template-label');
        const result = document.getElementById('proposal-result');

        state.templateFile = file || null;

        if (label) label.innerText = file ? file.name : 'Selecionar PPTX modelo';
        if (result) {
            result.style.display = file || state.file ? 'block' : 'none';
            result.style.borderLeftColor = file ? 'var(--cor-primaria)' : 'var(--cor-alerta)';
            result.innerHTML = file
                ? `PPTX modelo carregado.${state.file ? ' Clique em <strong>Gerar Proposta PPT</strong>.' : ' Agora selecione o <strong>PDF do orcamento</strong>.'}`
                : '';
        }
    };

    window.generateProposalFromBudget = async function () {
        const result = document.getElementById('proposal-result');
        const button = document.getElementById('proposal-generate-btn');

        if (!state.file) {
            Swal.fire('Selecione o PDF', 'Escolha o PDF do orcamento antes de gerar a proposta.', 'warning');
            return;
        }

        if (!state.templateFile) {
            Swal.fire('Selecione o PPTX modelo', 'Escolha o PowerPoint modelo para preservar os slides existentes e atualizar somente a ultima pagina.', 'warning');
            return;
        }

        try {
            if (button) {
                button.disabled = true;
                button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';
            }
            if (result) {
                result.style.display = 'block';
                result.style.borderLeftColor = 'var(--cor-primaria)';
                result.innerHTML = 'Lendo o PDF, renderizando as paginas e atualizando somente o ultimo slide do PPTX modelo...';
            }

            const text = await extractPdfText(state.file);
            const parsed = parseBudgetText(text, state.file.name);
            state.parsed = parsed;

            if (!parsed.items.length || !Number.isFinite(parsed.total)) {
                const confirmed = await Swal.fire({
                    title: 'Dados incompletos',
                    text: 'Nao consegui identificar todos os itens/valor total automaticamente. Deseja gerar mesmo assim?',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Gerar mesmo assim',
                    cancelButtonText: 'Cancelar',
                    confirmButtonColor: 'var(--cor-primaria)'
                });
                if (!confirmed.isConfirmed) return;
            }

            const fileName = await buildPptx(parsed);

            if (result) {
                result.style.display = 'block';
                result.style.borderLeftColor = 'var(--cor-sucesso)';
                result.innerHTML = `
                    <strong>Proposta gerada:</strong> ${escapeText(fileName)}<br>
                    Slides iniciais: <strong>preservados do modelo</strong><br>
                    Cliente: <strong>${escapeText(parsed.client)}</strong><br>
                    Total: <strong>${formatCurrency(parsed.total)}</strong> | Itens: <strong>${parsed.items.length}</strong>
                `;
            }

            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'PPT atualizado para download!', showConfirmButton: false, timer: 2600 });
        } catch (error) {
            console.error(error);
            if (result) {
                result.style.display = 'block';
                result.style.borderLeftColor = 'var(--cor-erro)';
                result.innerHTML = `Erro ao gerar proposta: ${escapeText(error.message || 'falha desconhecida')}`;
            }
            Swal.fire('Erro', error.message || 'Nao foi possivel gerar a proposta.', 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar Proposta PPT';
            }
        }
    };
})();
