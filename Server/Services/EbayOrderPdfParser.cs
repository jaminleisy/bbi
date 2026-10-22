using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;

namespace BenBotInventory.Server.Services;

/// <summary>Draft part inferred from an eBay order PDF (Type left blank for user review).</summary>
public class ParsedPartDraft
{
    public string? Type { get; set; }
    public string? Manufacturer { get; set; }
    public string? ModelNumber { get; set; }
    public decimal? Cost { get; set; }
    public DateTime? OrderDate { get; set; }
    public string? OrderUrl { get; set; }
    public string Seller { get; set; } = "eBay";
    public string Condition { get; set; } = "Used";
    public string? Location { get; set; }
    public string? Color { get; set; }
    public string? Merchant { get; set; }
    public string? Notes { get; set; }
    /// <summary>Informational for review UI only; not a DB column.</summary>
    public int Quantity { get; set; } = 1;
    public string? OrderId { get; set; }
    public string? SourceFileName { get; set; }
    /// <summary>Product thumbnail as a data URL for the review UI (not persisted).</summary>
    public string? ImageDataUrl { get; set; }
    /// <summary>True when this order id already appears in an existing part's OrderUrl.</summary>
    public bool IsDuplicate { get; set; }
}

public class ParseOrderPdfFileResult
{
    public string FileName { get; set; } = "";
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public List<ParsedPartDraft> Drafts { get; set; } = new();
}

/// <summary>
/// Extracts selectable text (and product thumbnails when present) from eBay order-receipt PDFs.
/// PDFs are not stored — callers pass bytes and discard.
/// </summary>
public class EbayOrderPdfParser
{
    private const int MinUsableTextChars = 40;
    private const int ModelMaxLen = 100;
    private const int MinProductImageEdge = 60;
    private const int MinProductImagePixels = 80 * 80;
    private const int MaxImageBytes = 1_500_000;

    private static readonly Regex OrderIdRegex = new(
        @"\b(\d{2}-\d{4,}-\d{4,})\b",
        RegexOptions.Compiled);

    private static readonly Regex OrderNumberLabelRegex = new(
        @"Order\s*number\s*[:\s]*(\d{2}-\d{4,}-\d{4,})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex TimePlacedRegex = new(
        @"Time\s*placed\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex SoldByRegex = new(
        @"Sold\s*by\s*([A-Za-z0-9._-]+?)(?=Delivery|Paid|Item|Tracking|Shipping|Order|Returns|Buy|Contact|Total|Sold|\s|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex TotalItemsRegex = new(
        @"Total\s*\$?\s*([\d,]+\.\d{2})\s*\(\s*(\d+)\s*items?\s*\)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Payment summary line — includes shipping (and tax when charged).</summary>
    private static readonly Regex OrderTotalRegex = new(
        @"Order\s*total\s*\$?\s*([\d,]+\.\d{2})",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex ItemInfoBlockRegex = new(
        @"Item\s*info\s*(.+?)\$\s*([\d,]+\.\d{2})\s*(?:Item\s*number|Qty|Quantity|Returns|Buy\s*again|More\s*actions)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.Singleline);

    private static readonly Regex QtyNearPriceRegex = new(
        @"(?:Qty|Quantity)\s*[:\s]*(\d+)|(\d+)\s*[x×]\s*\$",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex WhiteColorHintRegex = new(
        @"\b(white|ice|aero)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Shipping block from eBay order details (name usually follows the label).</summary>
    private static readonly Regex ShippingAddressRegex = new(
        @"Shipping\s*address\s*(.+?)(?:Payment\s*info|Order\s*total|How\s*do\s*you\s*like|$)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled | RegexOptions.Singleline);

    /// <summary>True canceled-order banner (not the "Cancel this order" action link).</summary>
    private static readonly Regex OrderCanceledRegex = new(
        @"your\s+order\s+was\s+cancel+ed|order\s+was\s+cancel+ed\s+on|this\s+order\s+(?:has\s+been\s+)?cancel+ed",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Refund issued / completed (may also appear on canceled orders).</summary>
    private static readonly Regex OrderRefundedRegex = new(
        @"you\s+got\s+a\s+refund|refund\s+issued|was\s+refunded|partial\s+refund|refunded\s*order\s*total|a\s+total\s+of\s*\$[\d,.]+\s+was\s+(?:sent|refunded)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly string[] KnownBrands =
    [
        "TEAMGROUP", "Team Group", "G.Skill", "G.SKILL", "Corsair", "Kingston", "Crucial",
        "Samsung", "Micron", "Patriot", "ADATA", "Silicon Power", "Intel", "AMD", "NVIDIA",
        "ASUS", "ASRock", "MSI", "Gigabyte", "EVGA", "Zotac", "PNY", "Sapphire", "PowerColor",
        "XFX", "Western Digital", "WD", "Seagate", "Toshiba", "SanDisk", "Cooler Master",
        "NZXT", "Fractal Design", "be quiet!", "Thermaltake", "Lian Li", "Noctua", "Arctic",
        "Deepcool", "Phanteks", "SilverStone", "Seasonic", "EVGA", "Super Flower", "Corsair",
        "Logitech", "Razer", "SteelSeries", "HyperX", "TP-Link", "ASUS", "Realtek"
    ];

    private sealed class ExtractedImage
    {
        public required string DataUrl { get; init; }
        public required double TopY { get; init; }
        public required int PixelArea { get; init; }
    }

    public ParseOrderPdfFileResult Parse(byte[] pdfBytes, string fileName)
    {
        var result = new ParseOrderPdfFileResult { FileName = fileName };

        string text;
        List<ExtractedImage> images;
        try
        {
            (text, images) = ExtractTextAndImages(pdfBytes);
        }
        catch (Exception ex)
        {
            result.Ok = false;
            result.Error = $"Could not read PDF: {ex.Message}";
            return result;
        }

        var compact = NormalizeWhitespace(text);
        if (compact.Length < MinUsableTextChars)
        {
            result.Ok = false;
            result.Error =
                "This PDF has little or no selectable text (common with image-only or Chrome CID prints). " +
                "Export/print with selectable text, or use eBay's printer-friendly page, then try again. OCR is not supported yet.";
            return result;
        }

        if (!LooksLikeEbayOrder(compact, fileName))
        {
            result.Ok = false;
            result.Error = "Does not look like an eBay order receipt (missing Order details / order number).";
            return result;
        }

        if (IsCanceledOrder(compact))
        {
            result.Ok = false;
            result.Error = "Order was canceled — skipped (not imported).";
            return result;
        }

        var refunded = IsRefundedOrder(compact);

        var orderId = ExtractOrderId(compact, fileName);
        var orderDate = ExtractOrderDate(compact);
        var orderUrl = orderId is null
            ? null
            : $"https://order.ebay.com/ord/show?orderId={orderId}";

        var orderQtyHint = 1;
        var totalMatch = TotalItemsRegex.Match(compact);
        if (totalMatch.Success && int.TryParse(totalMatch.Groups[2].Value, out var tq) && tq > 0)
            orderQtyHint = tq;

        var location = InferLocationFromShippingAddress(compact);
        var orderTotal = ExtractOrderTotal(compact);
        var merchant = Truncate(ExtractSoldBy(compact), 100);
        var drafts = ParseLineItems(compact, orderId, orderDate, orderUrl, fileName, orderQtyHint, location, orderTotal, merchant);
        if (drafts.Count == 0)
        {
            result.Ok = false;
            result.Error = "Recognized an eBay order but could not find any line items (Item info / title + price).";
            return result;
        }

        if (refunded)
            ApplyRefundedOrder(drafts);

        AssignProductImages(drafts, images);

        result.Ok = true;
        result.Drafts = drafts;
        return result;
    }

    private static bool IsCanceledOrder(string text) =>
        OrderCanceledRegex.IsMatch(text);

    private static bool IsRefundedOrder(string text) =>
        OrderRefundedRegex.IsMatch(text);

    /// <summary>Refunded (not canceled): cost $0 and REFUNDED: prefix on the model/title.</summary>
    private static void ApplyRefundedOrder(List<ParsedPartDraft> drafts)
    {
        foreach (var d in drafts)
        {
            d.Cost = 0m;
            var model = d.ModelNumber?.Trim() ?? "";
            if (!model.StartsWith("REFUNDED:", StringComparison.OrdinalIgnoreCase))
                d.ModelNumber = Truncate($"REFUNDED: {model}".Trim(), ModelMaxLen);
        }
    }

    private static (string Text, List<ExtractedImage> Images) ExtractTextAndImages(byte[] pdfBytes)
    {
        using var stream = new MemoryStream(pdfBytes, writable: false);
        using var doc = PdfDocument.Open(stream);
        var sb = new StringBuilder();
        var images = new List<ExtractedImage>();

        foreach (var page in doc.GetPages())
        {
            if (sb.Length > 0) sb.Append('\n');
            sb.Append(page.Text);

            foreach (var img in page.GetImages())
            {
                if (!TryEncodeImage(img, out var dataUrl, out var area))
                    continue;

                // Pdf Y grows upward; higher Top ≈ nearer the top of the page.
                var topY = img.BoundingBox.Top;
                images.Add(new ExtractedImage
                {
                    DataUrl = dataUrl,
                    TopY = topY,
                    PixelArea = area
                });
            }
        }

        return (sb.ToString(), images);
    }

    private static bool TryEncodeImage(IPdfImage img, out string dataUrl, out int pixelArea)
    {
        dataUrl = "";
        pixelArea = 0;

        var w = img.WidthInSamples;
        var h = img.HeightInSamples;
        if (w < MinProductImageEdge || h < MinProductImageEdge)
            return false;

        pixelArea = w * h;
        if (pixelArea < MinProductImagePixels)
            return false;

        // Tiny decorative / tracking pixels already filtered; also skip very wide banner strips
        // that are short (rewards / promo headers).
        if (w >= 3 * h && h < 100)
            return false;

        byte[]? bytes = null;
        string? mime = null;

        var raw = img.RawBytes.ToArray();
        if (LooksLikeJpeg(raw))
        {
            bytes = raw;
            mime = "image/jpeg";
        }
        else if (LooksLikePng(raw))
        {
            bytes = raw;
            mime = "image/png";
        }
        else if (img.TryGetPng(out var png) && png is { Length: > 0 })
        {
            bytes = png;
            mime = "image/png";
        }

        if (bytes is null || mime is null || bytes.Length == 0 || bytes.Length > MaxImageBytes)
            return false;

        dataUrl = $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        return true;
    }

    private static bool LooksLikeJpeg(byte[] raw) =>
        raw.Length >= 3 && raw[0] == 0xFF && raw[1] == 0xD8 && raw[2] == 0xFF;

    private static bool LooksLikePng(byte[] raw) =>
        raw.Length >= 8
        && raw[0] == 0x89 && raw[1] == 0x50 && raw[2] == 0x4E && raw[3] == 0x47
        && raw[4] == 0x0D && raw[5] == 0x0A && raw[6] == 0x1A && raw[7] == 0x0A;

    private static void AssignProductImages(List<ParsedPartDraft> drafts, List<ExtractedImage> images)
    {
        if (drafts.Count == 0 || images.Count == 0)
            return;

        if (drafts.Count == 1)
        {
            drafts[0].ImageDataUrl = images
                .OrderByDescending(i => i.PixelArea)
                .First().DataUrl;
            return;
        }

        // Multi-line: assign images top→bottom (largest first among remaining) to drafts in order.
        var remaining = images
            .OrderByDescending(i => i.TopY)
            .ThenByDescending(i => i.PixelArea)
            .ToList();

        for (var d = 0; d < drafts.Count && remaining.Count > 0; d++)
        {
            drafts[d].ImageDataUrl = remaining[0].DataUrl;
            remaining.RemoveAt(0);
        }
    }

    private static string NormalizeWhitespace(string text) =>
        Regex.Replace(text ?? "", @"\s+", " ").Trim();

    private static bool LooksLikeEbayOrder(string text, string fileName)
    {
        if (OrderIdRegex.IsMatch(text) &&
            (text.Contains("Order details", StringComparison.OrdinalIgnoreCase)
             || text.Contains("Order number", StringComparison.OrdinalIgnoreCase)
             || text.Contains("Order info", StringComparison.OrdinalIgnoreCase)
             || text.Contains("ebay", StringComparison.OrdinalIgnoreCase)))
            return true;

        if (fileName.Contains("ebay", StringComparison.OrdinalIgnoreCase) && OrderIdRegex.IsMatch(text))
            return true;

        return text.Contains("order.ebay.com", StringComparison.OrdinalIgnoreCase)
               || (text.Contains("Item info", StringComparison.OrdinalIgnoreCase)
                   && text.Contains("Order number", StringComparison.OrdinalIgnoreCase));
    }

    private static string? ExtractOrderId(string text, string fileName)
    {
        var labeled = OrderNumberLabelRegex.Match(text);
        if (labeled.Success) return labeled.Groups[1].Value;

        var fromName = OrderIdRegex.Match(fileName);
        if (fromName.Success) return fromName.Groups[1].Value;

        var any = OrderIdRegex.Match(text);
        return any.Success ? any.Groups[1].Value : null;
    }

    private static DateTime? ExtractOrderDate(string text)
    {
        var m = TimePlacedRegex.Match(text);
        if (!m.Success) return null;
        if (DateTime.TryParse(m.Groups[1].Value, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal, out var dt))
            return dt.Date;
        if (DateTime.TryParse(m.Groups[1].Value, CultureInfo.GetCultureInfo("en-US"),
                DateTimeStyles.AssumeLocal, out dt))
            return dt.Date;
        return null;
    }

    private static string? InferLocationFromShippingAddress(string text)
    {
        // Prefer the shipping-address section; fall back to full text for odd layouts.
        var block = text;
        var m = ShippingAddressRegex.Match(text);
        if (m.Success)
            block = m.Groups[1].Value;

        if (block.Contains("Leisy", StringComparison.OrdinalIgnoreCase))
            return "Ben";
        if (block.Contains("Brown", StringComparison.OrdinalIgnoreCase))
            return "Josh";
        return null;
    }

    private static string? ExtractSoldBy(string text)
    {
        var m = SoldByRegex.Match(text);
        if (!m.Success) return null;
        var name = m.Groups[1].Value.Trim();
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    private static decimal? ExtractOrderTotal(string text)
    {
        // Prefer "Order total $X.XX" from the payment summary when the amount is present.
        var matches = OrderTotalRegex.Matches(text);
        if (matches.Count > 0)
        {
            var last = matches[^1].Groups[1].Value;
            if (decimal.TryParse(last, NumberStyles.Number, CultureInfo.InvariantCulture, out var total))
                return total;
        }

        // Newer eBay layouts often only put the grand total (item + shipping + tax) as
        // "Total $X.XX (N item(s))" in Order info, while "Order total" has no adjacent $.
        var header = TotalItemsRegex.Match(text);
        if (header.Success
            && decimal.TryParse(header.Groups[1].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var headerTotal))
            return headerTotal;

        return null;
    }

    private static List<ParsedPartDraft> ParseLineItems(
        string text,
        string? orderId,
        DateTime? orderDate,
        string? orderUrl,
        string fileName,
        int orderQtyHint,
        string? location,
        decimal? orderTotal,
        string? merchant)
    {
        var drafts = new List<ParsedPartDraft>();
        var matches = ItemInfoBlockRegex.Matches(text);
        if (matches.Count == 0)
            return drafts;

        foreach (Match match in matches)
        {
            var rawTitle = match.Groups[1].Value;
            if (!decimal.TryParse(match.Groups[2].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var price))
                continue;

            var title = CleanTitle(rawTitle);
            if (string.IsNullOrWhiteSpace(title))
                continue;

            var qty = ExtractQuantity(rawTitle, text, matches.Count, orderQtyHint);
            var qtyInBlock = QtyNearPriceRegex.Match(rawTitle + " " + match.Value);
            if (qtyInBlock.Success)
            {
                var qStr = qtyInBlock.Groups[1].Success ? qtyInBlock.Groups[1].Value : qtyInBlock.Groups[2].Value;
                if (int.TryParse(qStr, out var q) && q > 1)
                    qty = q;
            }

            var (mfr, model) = SplitBrand(title);
            drafts.Add(new ParsedPartDraft
            {
                Type = InferTypeFromTitle(title),
                Manufacturer = Truncate(mfr, 100),
                ModelNumber = Truncate(model ?? title, ModelMaxLen),
                // Temporary: item sold-for; replaced below with Order total when available.
                Cost = price,
                OrderDate = orderDate,
                OrderUrl = orderUrl,
                Seller = "eBay",
                Condition = "Used",
                Location = location,
                Color = InferColorFromTitle(title),
                Merchant = merchant,
                Quantity = qty,
                OrderId = orderId,
                SourceFileName = fileName
            });
        }

        ApplyOrderTotalAsCost(drafts, orderTotal);
        return drafts;
    }

    /// <summary>
    /// Use eBay "Order total" (item + shipping + tax) as cost.
    /// One line → that total; multiple lines → split total in proportion to item prices.
    /// </summary>
    private static void ApplyOrderTotalAsCost(List<ParsedPartDraft> drafts, decimal? orderTotal)
    {
        if (orderTotal is null || orderTotal <= 0 || drafts.Count == 0)
            return;

        if (drafts.Count == 1)
        {
            drafts[0].Cost = orderTotal;
            return;
        }

        var itemSum = drafts.Sum(d => d.Cost ?? 0m);
        if (itemSum <= 0)
        {
            // Equal split if we somehow lack item prices.
            var equalCents = SplitCents(orderTotal.Value, drafts.Count);
            for (var i = 0; i < drafts.Count; i++)
                drafts[i].Cost = equalCents[i];
            return;
        }

        // Proportional allocation so costs sum exactly to order total (includes shipping).
        var totalCents = (long)Math.Round(orderTotal.Value * 100m, MidpointRounding.AwayFromZero);
        long assigned = 0;
        for (var i = 0; i < drafts.Count; i++)
        {
            if (i == drafts.Count - 1)
            {
                drafts[i].Cost = (totalCents - assigned) / 100m;
            }
            else
            {
                var share = (double)((drafts[i].Cost ?? 0m) / itemSum);
                var cents = (long)Math.Floor(totalCents * share);
                drafts[i].Cost = cents / 100m;
                assigned += cents;
            }
        }
    }

    private static decimal[] SplitCents(decimal total, int count)
    {
        var totalCents = (long)Math.Round(total * 100m, MidpointRounding.AwayFromZero);
        var baseCents = totalCents / count;
        var rem = (int)(totalCents % count);
        var result = new decimal[count];
        for (var i = 0; i < count; i++)
            result[i] = (baseCents + (i < rem ? 1 : 0)) / 100m;
        return result;
    }

    private static string? InferColorFromTitle(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        return WhiteColorHintRegex.IsMatch(title) ? "white" : null;
    }

    /// <summary>
    /// Best-effort type from listing title. More specific patterns run first; null if unsure.
    /// </summary>
    private static string? InferTypeFromTitle(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;

        // Ordered: first match wins. Keep patterns specific to limit false positives.
        (string Type, string Pattern)[] rules =
        [
            ("gpuSupport", @"\b(gpu\s*support|graphics\s*card\s*(support|brace|holder)|anti[- ]?sag)\b"),
            ("gpuVerticalBracket", @"\b(vertical\s*(gpu|graphics)|gpu\s*vertical)\b"),
            ("psuCable", @"\b(psu\s*cable|power\s*supply\s*cable|12vhpwr|12v[- ]?2x6|pcie\s*power\s*cable|extension\s*cable\s*kit)\b"),
            ("rgbController", @"\b(rgb\s*(controller|hub|splitter)|fan\s*hub|argb\s*(controller|hub))\b"),
            ("pcie wifi", @"\b(pcie\s*(wifi|wireless|wlan)|wifi\s*(pcie|card|adapter)|wireless\s*(pcie|network\s*card)|ax210|ax200|intel\s*wifi)\b"),
            ("usb wifi", @"\b(usb\s*(wifi|wireless|wlan)|wifi\s*dongle|wireless\s*usb\s*adapter)\b"),
            ("usb bluetooth", @"\b(usb\s*bluetooth|bluetooth\s*(adapter|dongle))\b"),
            ("winkey", @"\b(windows\s*(10|11)?\s*(pro|home)?\s*(coa|key|license)|product\s*key|win\s*(10|11)\s*(pro|home)?\s*key)\b"),
            ("cpuCooler", @"\b(cpu\s*cooler|liquid\s*cooler|aio\s*(cooler|liquid)?|air\s*cooler|tower\s*cooler|all[- ]?in[- ]?all\s*cooler|noctua\s+nh[- ]|hyper\s*212|kraken|mag\s*coreliquid|liquid\s*freezer)\b"),
            ("ram", @"\b(ddr[45]|dimm|sodimm|\bram\b|memory\s*kit|desktop\s*memory|laptop\s*memory)\b"),
            ("storage", @"\b(nvme|m\.?2\s*ssd|\bssd\b|\bhdd\b|hard\s*drive|solid\s*state|sata\s*ssd|gen[45]\s*ssd|wd[_ ]?black\s*sn|samsung\s*990|crucial\s*t[75]00)\b"),
            ("gpu", @"\b(rtx\s*\d{3,5}|gtx\s*\d{3,4}|rx\s*\d{3,4}|geforce|radeon|graphics\s*card|video\s*card|quadro|arc\s*a\d{3})\b"),
            ("cpu", @"\b(ryzen\s*[3579]|ryzen\s*threadripper|core\s*i[3579](-\d+)?|intel\s*core\s*ultra|core\s*ultra\s*[579]|threadripper|intel\s*xeon|amd\s*ryzen)\b"),
            ("mobo", @"\b(motherboard|mainboard|\bmobo\b|mother\s*board|b[456]\d{2}|x[567]\d{2}|z[4567]\d{2}|a[456]\d{2}|h[456]\d{2}|b\d{3}\s*(gaming|msi|asus|gigabyte|asrock))\b"),
            ("psu", @"\b(\bpsu\b|power\s*supply|modular\s*(psu|power)|watt\s*(psu|power\s*supply)|\d{3,4}\s*w\s*(80\+|gold|platinum|psu|power))\b"),
            ("case", @"\b(pc\s*case|computer\s*case|mid[- ]?tower|full[- ]?tower|mini[- ]?tower|atx\s*case|matx\s*case|itx\s*case|gaming\s*case|\bcase\b(?!\s*fan))\b"),
            ("fan", @"\b(case\s*fan|pwm\s*fan|cooling\s*fan|120mm\s*fan|140mm\s*fan|argb\s*fan|rgb\s*fan)\b"),
            ("monitor", @"\b(monitor|gaming\s*display|\d{2}([.,]\d)?\s*inch\s*(monitor|display)|ultrawide)\b"),
            ("keyboard", @"\b(keyboard|mech(anical)?\s*keyboard|keychron|gaming\s*kb)\b"),
            ("mouse", @"\b(gaming\s*mouse|\bmouse\b|mice)\b"),
            ("adapter", @"\b(adapter|converter|riser(?!\s*fan)|dongle(?!\s*wifi))\b"),
        ];

        foreach (var (type, pattern) in rules)
        {
            if (Regex.IsMatch(title, pattern, RegexOptions.IgnoreCase))
                return type;
        }

        return null;
    }

    private static int ExtractQuantity(string rawTitle, string fullText, int lineCount, int orderQtyHint)
    {
        var m = QtyNearPriceRegex.Match(rawTitle);
        if (m.Success)
        {
            var qStr = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[2].Value;
            if (int.TryParse(qStr, out var q) && q > 0) return q;
        }

        if (lineCount == 1 && orderQtyHint > 1)
            return orderQtyHint;

        return 1;
    }

    private static string CleanTitle(string raw)
    {
        var t = NormalizeWhitespace(raw);
        t = Regex.Replace(t, @"^(DELIVERED|Shipped|Track\s*Package).*?(?=[A-Z0-9])", "",
            RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"Track\s*Package.*$", "", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"Item\s*number.*$", "", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"Returns\s+not\s+accepted.*$", "", RegexOptions.IgnoreCase);
        t = Regex.Replace(t, @"(\d)([A-Z]{2,}(?:-\d+)?)\b", "$1 $2");
        t = NormalizeWhitespace(t);
        return t.Trim(' ', '-', '|', '•');
    }

    private static (string? Manufacturer, string? Model) SplitBrand(string title)
    {
        foreach (var brand in KnownBrands.OrderByDescending(b => b.Length))
        {
            if (title.StartsWith(brand, StringComparison.OrdinalIgnoreCase))
            {
                var rest = title[brand.Length..].TrimStart(' ', '-', ':');
                return (brand, string.IsNullOrWhiteSpace(rest) ? title : rest);
            }
        }
        return (null, title);
    }

    private static string? Truncate(string? value, int max)
    {
        if (value is null) return null;
        value = value.Trim();
        if (value.Length <= max) return value;
        return value[..max].TrimEnd();
    }
}
