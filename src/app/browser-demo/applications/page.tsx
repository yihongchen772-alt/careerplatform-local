/**
 * Local stand-in for an employer's candidate center ("我的投递"), for testing
 * the 网申浏览器's 设为进度页 prompt without logging into a real site.
 */
export default function BrowserDemoApplicationsPage() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-10">
      <h1 className="text-2xl font-semibold">我的投递</h1>
      <p className="text-sm text-muted-foreground">投递记录（本地测试页）</p>
      <table className="w-full text-sm">
        <tbody>
          <tr><td>数据分析师</td><td>简历筛选中</td></tr>
        </tbody>
      </table>
    </main>
  );
}
