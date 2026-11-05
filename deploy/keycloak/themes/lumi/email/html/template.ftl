<#ftl output_format="HTML" auto_esc=true>
<#-- Keep the no-argument macro compatible with every inherited Keycloak email. -->
<#macro emailLayout title="" fallbackLink="">
<!DOCTYPE html>
<html lang="${locale.language}" dir="${(ltr)?then('ltr','rtl')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><#if title?has_content>${title}<#else>lumi.</#if></title>
</head>
<body bgcolor="#f5f3fa" style="margin:0;padding:0;background-color:#f5f3fa;color:#30283f;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f5f3fa;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;table-layout:fixed;font-family:'Trebuchet MS','Avenir Next','Segoe UI',Arial,sans-serif;">
          <tr>
            <td style="padding:0 8px 24px;color:#69449a;font-size:36px;font-weight:bold;letter-spacing:-1.8px;line-height:1.2;">lumi<span style="color:#a38abb;">.</span></td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" style="padding:28px 24px;background-color:#ffffff;border:1px solid #d9cde6;border-radius:24px 24px 24px 8px;color:#30283f;font-size:16px;line-height:1.65;overflow-wrap:anywhere;word-wrap:break-word;">
              <#if title?has_content>
                <h1 style="margin:0 0 20px;color:#30283f;font-size:26px;font-weight:bold;letter-spacing:-0.5px;line-height:1.25;">${title}</h1>
              </#if>
              <#nested>
            </td>
          </tr>
          <#if fallbackLink?has_content>
            <tr>
              <td style="padding:20px 8px 0;color:#70617d;font-size:12px;line-height:1.6;">
                <p style="margin:0 0 8px;">${msg("lumiLinkFallback")}</p>
                <p style="margin:0;word-break:break-all;overflow-wrap:anywhere;"><a href="${fallbackLink}" style="color:#70617d;text-decoration:underline;word-break:break-all;">${fallbackLink}</a></p>
              </td>
            </tr>
          </#if>
          <tr>
            <td style="padding:20px 8px 0;color:#70617d;font-size:13px;line-height:1.6;">${msg("lumiEmailFooter")}</td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>
</#macro>

<#macro action link label>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td align="center" bgcolor="#69449a" style="background-color:#69449a;border-radius:12px;">
        <a href="${link}" style="display:inline-block;padding:14px 22px;border:1px solid #69449a;border-radius:12px;color:#ffffff;font-size:16px;font-weight:bold;line-height:1.5;text-align:center;text-decoration:none;mso-padding-alt:0;">
          <!--[if mso]><i style="mso-font-width:100%;mso-text-raise:21pt;" hidden>&nbsp;&nbsp;</i><![endif]-->
          <span style="mso-text-raise:10pt;">${label}</span>
          <!--[if mso]><i style="mso-font-width:100%;" hidden>&nbsp;&nbsp;</i><![endif]-->
        </a>
      </td>
    </tr>
  </table>
</#macro>

<#macro expiration>
  <p style="margin:0 0 16px;color:#70617d;font-size:14px;line-height:1.6;">${msg("lumiLinkExpiration", linkExpirationFormatter(linkExpiration))}</p>
</#macro>

<#macro ignore messageKey>
  <p style="margin:0;padding-top:16px;border-top:1px solid #eae2f4;color:#70617d;font-size:14px;line-height:1.6;">${msg(messageKey)}</p>
</#macro>
