<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("lumiVerifyTitle")>
  <p style="margin:0 0 16px;">${msg("lumiCodeIntro")}</p>
  <p style="margin:24px 0;padding:16px;background-color:#eae2f4;border-radius:12px;color:#30283f;font-size:28px;font-weight:bold;letter-spacing:3px;text-align:center;">${code}</p>
  <@layout.ignore messageKey="lumiVerifyIgnore" />
</@layout.emailLayout>
