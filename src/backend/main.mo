import Time "mo:core/Time";
import Float "mo:core/Float";
import Text "mo:core/Text";
import Char "mo:core/Char";
import Nat32 "mo:core/Nat32";
import OutCall "http-outcalls/outcall";



actor {
  type PriceData = {
    eurUsd : Float;
    gbpUsd : Float;
    usdJpy : Float;
    audUsd : Float;
    eurGbp : Float;
    usdCad : Float;
    nzdUsd : Float;
    eurJpy : Float;
  };

  type Result<T, E> = { #ok : T; #err : E };

  var lastFetchTime : Int = 0;
  var lastPrices : ?PriceData = null;

  public query func transform(input : OutCall.TransformationInput) : async OutCall.TransformationOutput {
    OutCall.transform(input);
  };

  func digitF(d : Nat32) : Float {
    switch (d) {
      case 0 { 0.0 }; case 1 { 1.0 }; case 2 { 2.0 }; case 3 { 3.0 };
      case 4 { 4.0 }; case 5 { 5.0 }; case 6 { 6.0 }; case 7 { 7.0 };
      case 8 { 8.0 }; case _ { 9.0 };
    };
  };

  func findSubstring(haystack : [Char], needle : [Char], from : Nat) : ?Nat {
    let hLen = haystack.size();
    let nLen = needle.size();
    if (nLen == 0) return ?from;
    if (hLen < nLen) return null;
    var i = from;
    while (i + nLen <= hLen) {
      var j = 0;
      var matched = true;
      while (j < nLen) {
        if (haystack[i + j] != needle[j]) {
          matched := false;
          j := nLen;
        } else {
          j += 1;
        };
      };
      if (matched) return ?i;
      i += 1;
    };
    null;
  };

  func parseFloatFromChars(chars : [Char], start : Nat) : ?Float {
    var i = start;
    if (i >= chars.size()) return null;
    var sign : Float = 1.0;
    if (chars[i] == '-') { sign := -1.0; i += 1 };
    if (i >= chars.size()) return null;

    var intF : Float = 0.0;
    label intScan while (i < chars.size()) {
      let code = (chars[i]).toNat32();
      if (code >= 48 and code <= 57) {
        intF := intF * 10.0 + digitF(code - 48);
        i += 1;
      } else {
        break intScan;
      };
    };

    var result : Float = intF;

    if (i < chars.size() and chars[i] == '.') {
      i += 1;
      var factor : Float = 0.1;
      label decScan while (i < chars.size()) {
        let code = (chars[i]).toNat32();
        if (code >= 48 and code <= 57) {
          result := result + digitF(code - 48) * factor;
          factor := factor * 0.1;
          i += 1;
        } else {
          break decScan;
        };
      };
    };
    ?(sign * result);
  };

  func extractFloat(chars : [Char], key : Text) : ?Float {
    let needleText : Text = "\"" # key # "\":";
    let needle = needleText.toArray();
    switch (findSubstring(chars, needle, 0)) {
      case null null;
      case (?pos) {
        var i = pos + needle.size();
        while (i < chars.size() and chars[i] == ' ') { i += 1 };
        parseFloatFromChars(chars, i);
      };
    };
  };

  // API returns: 1 USD = X units of currency
  // EUR/USD (price of 1 EUR in USD) = 1 / (units of EUR per 1 USD) = 1/eur_rate
  // GBP/USD = 1/gbp_rate
  // USD/JPY = jpy_rate (1 USD = jpy_rate JPY, which IS the USD/JPY price)
  // AUD/USD = 1/aud_rate
  // USD/CAD = cad_rate
  // NZD/USD = 1/nzd_rate
  // EUR/GBP = (1/eur_rate) / (1/gbp_rate) = gbp_rate/eur_rate
  // EUR/JPY = (1/eur_rate) * jpy_rate
  public shared func getLivePrices() : async Result<PriceData, Text> {
    let url = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json";
    let body = await OutCall.httpGetRequest(url, [], transform);
    let chars = body.toArray();

    let eurOpt = extractFloat(chars, "eur");
    let gbpOpt = extractFloat(chars, "gbp");
    let jpyOpt = extractFloat(chars, "jpy");
    let audOpt = extractFloat(chars, "aud");
    let cadOpt = extractFloat(chars, "cad");
    let nzdOpt = extractFloat(chars, "nzd");

    switch (eurOpt, gbpOpt, jpyOpt, audOpt, cadOpt, nzdOpt) {
      case (?eur, ?gbp, ?jpy, ?aud, ?cad, ?nzd) {
        // Invert USD-based rates to get correct forex pairs
        let eurUsd = if (eur > 0.0) 1.0 / eur else 0.0;
        let gbpUsd = if (gbp > 0.0) 1.0 / gbp else 0.0;
        let audUsd = if (aud > 0.0) 1.0 / aud else 0.0;
        let nzdUsd = if (nzd > 0.0) 1.0 / nzd else 0.0;
        let eurGbp = if (eur > 0.0) gbp / eur else 0.0;
        let eurJpy = if (eur > 0.0) jpy / eur else 0.0;
        let prices : PriceData = {
          eurUsd = eurUsd;
          gbpUsd = gbpUsd;
          usdJpy = jpy;
          audUsd = audUsd;
          usdCad = cad;
          nzdUsd = nzdUsd;
          eurGbp = eurGbp;
          eurJpy = eurJpy;
        };
        lastFetchTime := Time.now();
        lastPrices := ?prices;
        #ok(prices);
      };
      case _ {
        switch (lastPrices) {
          case (?p) { #ok(p) };
          case null { #err("Failed to parse price data from API") };
        };
      };
    };
  };

  public query func getLastFetchTime() : async Int {
    lastFetchTime;
  };

  public query func getLastPrices() : async Result<?PriceData, Text> {
    #ok(lastPrices);
  };
};
