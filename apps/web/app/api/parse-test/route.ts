import { parseTimetable } from "../../lib/parseTimetable";
export async function GET() {
  const xml = `
<?xml version="1.0" encoding="UTF-8"?>
<timetable station="Test">
  <s id="1">
    <tl n="29531" />
    <ar pt="2606182004" pp="2" l="RE3" />
    <dp pt="2606182004" pp="2" l="RE3" />
  </s>
</timetable>
`;

  const trains =
  parseTimetable(xml);

return Response.json({
  count: trains.length,
  trains,
});
}