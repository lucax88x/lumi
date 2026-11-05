<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("lumiLinkTitle") fallbackLink=link>
  <p style="margin:0 0 16px;">${msg("lumiLinkIntro", identityProviderDisplayName, identityProviderContext.username)}</p>
  <p style="margin:0 0 16px;">${msg("lumiLinkExplanation", identityProviderDisplayName)}</p>
  <@layout.action link=link label=msg("lumiLinkAction") />
  <@layout.expiration />
  <@layout.ignore messageKey="lumiLinkIgnore" />
</@layout.emailLayout>
