export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = u.searchParams.get("tool") || "";
  const base = process.env.NEXT_PUBLIC_BASE_URL || u.origin;
  const js = `(function(){
  var slug=${JSON.stringify(slug)}; if(!slug){console.warn("Tailor embed: missing ?tool=slug");return;}
  var base=${JSON.stringify(base)};
  var btn=document.createElement("button");
  btn.setAttribute("aria-label","Open chat");
  btn.style.cssText="position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:28px;border:0;background:#0e6b60;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483646";
  btn.textContent="\\u{1F4AC}";
  var frame=document.createElement("iframe");
  frame.src=base+"/t/"+encodeURIComponent(slug)+"?embed=1";
  frame.title="Assistant";
  frame.style.cssText="position:fixed;right:20px;bottom:88px;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:none;background:#fff;z-index:2147483647";
  btn.onclick=function(){var open=frame.style.display!=="none";frame.style.display=open?"none":"block";btn.textContent=open?"\\u{1F4AC}":"\\u2715";};
  document.body.appendChild(frame);document.body.appendChild(btn);
  fetch(base+"/api/tools/"+encodeURIComponent(slug)).then(function(r){return r.json()}).then(function(t){if(t&&t.brand&&t.brand.primary){btn.style.background=t.brand.primary;}}).catch(function(){});
})();`;
  return new Response(js, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" } });
}
