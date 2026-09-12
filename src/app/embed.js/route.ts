import { headers } from "next/headers";
import { tools } from "@/lib/db";

export const dynamic = "force-dynamic";

function textOn(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111111" : "#ffffff";
}

/** The one-line widget. The base URL comes from the script tag itself, so it works on any host. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = u.searchParams.get("tool") || "";
  const h = await headers();
  const proto = h.get("x-forwarded-proto") || u.protocol.replace(":", "");
  const host = h.get("x-forwarded-host") || h.get("host") || u.host;
  const serverBase = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;
  let brand = "#0e6b60";
  let label = "Chat with us";
  if (slug) {
    try {
      const tool = await (await tools()).findOne({ _id: slug });
      if (tool) {
        brand = tool.config.brand.primary;
        label = `Chat with ${tool.config.name}`;
      }
    } catch {
      /* the widget still works with defaults */
    }
  }
  const js = `(function(){
  var slug=${JSON.stringify(slug)}; if(!slug){console.warn("Tailor embed: missing ?tool=slug");return;}
  var script=document.currentScript; var base=${JSON.stringify(serverBase)};
  try{ if(script&&script.src){ base=new URL(script.src).origin; } }catch(e){}
  var brand=${JSON.stringify(brand)}, ink=${JSON.stringify(textOn(brand))};
  var btn=document.createElement("button");
  btn.type="button"; btn.setAttribute("aria-label",${JSON.stringify(label)}); btn.setAttribute("aria-expanded","false");
  btn.style.cssText="position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:28px;border:0;background:"+brand+";color:"+ink+";font-size:24px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483646";
  btn.textContent="\\u{1F4AC}";
  var frame=document.createElement("iframe");
  frame.title=${JSON.stringify(label)};
  frame.style.cssText="position:fixed;right:20px;bottom:88px;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:none;background:#fff;z-index:2147483647";
  var loaded=false;
  btn.onclick=function(){
    var open=frame.style.display!=="none";
    if(!open&&!loaded){ frame.src=base+"/t/"+encodeURIComponent(slug)+"?embed=1"; loaded=true; }
    frame.style.display=open?"none":"block";
    btn.textContent=open?"\\u{1F4AC}":"\\u2715";
    btn.setAttribute("aria-expanded",open?"false":"true");
  };
  document.body.appendChild(frame);document.body.appendChild(btn);
})();`;
  return new Response(js, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
}
