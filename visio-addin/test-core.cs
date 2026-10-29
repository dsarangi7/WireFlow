using System;
using System.Collections.Generic;
using Ayk.WireFlow.VisioAddIn;

public sealed class FakeCell { public string FormulaU { get; set; } public double ResultIU { get; set; } }
public sealed class FakeCells {
    private readonly Dictionary<string,FakeCell> cells = new Dictionary<string,FakeCell>();
    public FakeCell this[string name] { get { if (!cells.ContainsKey(name)) cells[name]=new FakeCell(); return cells[name]; } }
}
public sealed class FakeShape {
    public FakeCells CellsU = new FakeCells(); public string Text { get; set; }
    public short AddSection(short section) { if(section != 242) throw new Exception("Wrong section"); return section; }
    public short AddNamedRow(short section,string name,short tag) { if(section != 242 || tag != 0) throw new Exception("Wrong row"); return 0; }
}
public sealed class FakeMouseWindow { public object Page { get; set; } }
public sealed class FakeMouseEvent { public int Button { get; set; } public double x { get; set; } public double y { get; set; } public FakeMouseWindow Window { get; set; } }
public sealed class FakePage {
    public readonly List<FakeShape> Shapes = new List<FakeShape>();
    public int FailAt = -1;
    public FakeShape DrawLine(double x1,double y1,double x2,double y2) {
        if (Shapes.Count == FailAt) throw new InvalidOperationException("Simulated draw failure");
        var shape = new FakeShape(); Shapes.Add(shape); return shape;
    }
}
public sealed class FakeReadShapes {
    public readonly List<FakeShape> Items = new List<FakeShape>();
    public int Count { get { return Items.Count; } }
    public FakeShape this[int oneBased] { get { return Items[oneBased-1]; } }
}
public sealed class FakeReadPage { public readonly FakeReadShapes Shapes=new FakeReadShapes(); }
public sealed class FakeApp {
    public FakePage Page; public int Starts, Ends; public bool Committed; private int before;
    public int BeginUndoScope(string name) { Starts++; before=Page.Shapes.Count; return 1; }
    public void EndUndoScope(int id, bool commit) { Ends++; Committed=commit; if (!commit) Page.Shapes.RemoveRange(before,Page.Shapes.Count-before); }
}
public static class TestCore {
    private static void Check(bool condition,string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }
    private static Segment Line(double x1,double y1,double x2,double y2) { return new Segment { A=new Point(x1,y1),B=new Point(x2,y2) }; }
    public static int Main() {
        var addin=new WireFlowAddIn();
        Check(addin.GetCustomUI("Microsoft.Visio.Document").Contains("onAction=\"OpenWorkspace\""),"ribbon advertises the workspace callback");
        Check(typeof(WireFlowAddIn).GetInterface("IDTExtensibility2") != null && typeof(WireFlowAddIn).GetInterface("IRibbonExtensibility") != null,"COM add-in exposes lifecycle and ribbon interfaces");
        var sink=new PageMouseSink(); var expectedPage=new object(); int captured=0; double clickedX=0, clickedY=0;
        sink.SetHandlers((p,x,y)=> { if (!Object.ReferenceEquals(p,expectedPage)) return false; captured++; clickedX=x; clickedY=y; return true; }, message => { throw new Exception(message); });
        var mouse=new FakeMouseEvent{Button=1,x=3.5,y=4.25,Window=new FakeMouseWindow{Page=expectedPage}};
        Check((bool)sink.VisEventProc(709,null,0,0,mouse,null) && captured==1 && clickedX==3.5 && clickedY==4.25,"left click delivers exact internal drawing coordinates and suppresses default");
        mouse.Button=2; Check(!(bool)sink.VisEventProc(709,null,0,0,mouse,null) && captured==1,"right click does not capture or suppress default");
        mouse.Button=1; mouse.Window.Page=new object(); Check(!(bool)sink.VisEventProc(709,null,0,0,mouse,null) && captured==1,"click on another page remains untouched");
        Check(!(bool)sink.VisEventProc(710,null,0,0,mouse,null),"mouse move is not treated as a port click");
        Check(DraftReview.Intersects(Line(0,0,2,2),Line(0,2,2,0)),"interior crossing is reported");
        Check(!DraftReview.Intersects(Line(0,0,1,1),Line(1,1,2,0)),"shared endpoints are not reported as crossing");
        Check(DraftReview.Intersects(Line(0,0,2,0),Line(1,0,1,1)),"endpoint touching another segment interior is reported");
        Check(DraftReview.Intersects(Line(0,0,2,0),Line(1,0,3,0)),"collinear overlapping lines are reported");
        Check(!DraftReview.Intersects(Line(0,0,1,0),Line(1,0,2,0)),"collinear lines meeting at one endpoint are not reported");
        Check(!DraftReview.Intersects(Line(0,0,1,0),Line(0,1,1,1)) && !DraftReview.Intersects(Line(0,0,1,0),Line(2,0,3,0)),"parallel and separated lines are not reported");
        Check(DraftReview.FindCrossings(new [] {Line(0,0,2,2),Line(0,2,2,0),Line(3,3,4,4)}).Count==1,"crossing review counts each wire pair once");
        Check(DraftReview.FindBetween(new [] {Line(0,0,2,2)},new [] {Line(0,2,2,0),Line(3,3,4,4)}).Count==1,"crossings against other SSC draft wires are checked");
        var plan=new DraftPlan(); plan.Modules=2;
        string[] names={"SSC.S","SSC.N","SSC.NEG","SSC.POS","SSC.B-","SSC.B+","JB.NEG","JB.POS","M1.S","M1.N","M1.NEG","M1.POS","M2.S","M2.N","M2.NEG","M2.POS"};
        for(int i=0;i<names.Length;i++) plan.Set(names[i],i+1,i+1);
        var wires=plan.Build();
        Check(wires.Count==8,"two modules produce eight explicit draft connections");
        Check(wires[0].From=="SSC.POS" && wires[0].To=="M1.POS" && wires[1].From=="SSC.S" && wires[1].To=="M1.N", "SSC to first module polarity and communication");
        Check(wires[2].From=="M1.NEG" && wires[2].To=="M2.POS" && wires[3].From=="M1.S" && wires[3].To=="M2.N", "module sequence preserves explicit terminals");
        Check(wires[4].From=="SSC.NEG" && wires[4].To=="M2.NEG" && wires[5].From=="SSC.N" && wires[5].To=="M2.S", "last module returns to SSC");
        Check(wires[6].From=="SSC.B-" && wires[6].To=="JB.NEG" && wires[7].From=="SSC.B+" && wires[7].To=="JB.POS", "junction box polarity");
        bool duplicate=false; try { plan.Set("M2.POS",1,1); } catch (InvalidOperationException) { duplicate=true; }
        Check(duplicate,"a terminal marker cannot be reused for another port");
        Check(plan.Remove("M2.POS") && !plan.Remove("M2.POS"),"last terminal can be removed once for correction");
        bool afterUndo=false; try { plan.Build(); } catch (InvalidOperationException) { afterUndo=true; }
        Check(afterUndo,"an undone terminal blocks drawing until re-marked");
        plan.Set("M2.POS",16,16);
        var order=MarkPersistence.Steps(2); int restoredCount;
        var partial=new DraftPlan{Modules=2,Bank=2,Ssc=3}; for(int i=0;i<5;i++) partial.Set(order[i],i+1,i+1);
        var serialized=MarkPersistence.Serialize(partial,@"G:\\sample.vsdx",42,5);
        var restored=MarkPersistence.Deserialize(serialized,@"g:\\sample.vsdx",42,out restoredCount);
        Check(restoredCount==5 && restored.Modules==2 && restored.Bank==2 && restored.Ssc==3 && restored.Terminals[order[4]].X==5,"partial marks and bank/SSC identity round trip for the original drawing and page");
        bool differentPage=false; try { MarkPersistence.Deserialize(serialized,@"G:\\sample.vsdx",43,out restoredCount); } catch(InvalidOperationException) { differentPage=true; }
        Check(differentPage,"marks cannot be loaded onto a different page");
        bool differentFile=false; try { MarkPersistence.Deserialize(serialized,@"G:\\other.vsdx",42,out restoredCount); } catch(InvalidOperationException) { differentFile=true; }
        Check(differentFile,"marks cannot be loaded into a different drawing");
        bool malformed=false; try { MarkPersistence.Deserialize(serialized.Replace("SSC.S", "M2.POS"),@"G:\\sample.vsdx",42,out restoredCount); } catch(InvalidOperationException) { malformed=true; }
        Check(malformed,"out-of-order marking files are rejected");
        bool oldVersion=false; try { MarkPersistence.Deserialize(serialized.Replace("\"Version\":2", "\"Version\":1"),@"G:\\sample.vsdx",42,out restoredCount); } catch(InvalidOperationException) { oldVersion=true; }
        Check(oldVersion,"old mark files without verified bank and SSC identity are rejected");
        plan.Bank=2; plan.Ssc=3;
        var page=new FakePage(); var app=new FakeApp{Page=page};
        var incomplete=new DraftPlan{Modules=2}; bool rejected=false;
        try { DraftRenderer.Draw(app,page,incomplete); } catch(InvalidOperationException) { rejected=true; }
        Check(rejected && page.Shapes.Count==0 && app.Starts==0,"incomplete terminals are rejected before page changes");
        Check(DraftRenderer.Draw(app,page,plan)==8 && page.Shapes.Count==8 && app.Committed && app.Ends==1,"valid plan draws once within one undo scope");
        Check(page.Shapes[0].CellsU["LineColor"].FormulaU=="RGB(255,0,0)" && page.Shapes[1].CellsU["LineColor"].FormulaU=="RGB(0,176,80)","draft power and communication colours");
        Check(page.Shapes[0].CellsU["User.WireFlowFrom.Value"].FormulaU=="\"SSC.POS\"" && page.Shapes[0].CellsU["User.WireFlowTo.Value"].FormulaU=="\"M1.POS\"" && page.Shapes[0].CellsU["User.WireFlowStatus.Value"].FormulaU=="\"DRAFT\"" && page.Shapes[0].CellsU["User.WireFlowBank.Value"].FormulaU=="\"2\"" && page.Shapes[0].CellsU["User.WireFlowSSC.Value"].FormulaU=="\"3\"", "every generated shape carries explicit bank, SSC and draft endpoint metadata");
        var reading=new FakeReadPage(); reading.Shapes.Items.Add(new FakeShape());
        var tagged=page.Shapes[0]; tagged.CellsU["BeginX"].ResultIU=0; tagged.CellsU["BeginY"].ResultIU=0; tagged.CellsU["EndX"].ResultIU=2; tagged.CellsU["EndY"].ResultIU=2; reading.Shapes.Items.Add(tagged);
        var broken=new FakeShape(); broken.CellsU["User.WireFlowStatus.Value"].FormulaU="\"DRAFT\""; reading.Shapes.Items.Add(broken);
        var existing=DraftReview.ReadExisting(reading);
        Check(existing.Segments.Count==1 && existing.Unreadable==1 && existing.Segments[0].From=="B2/SSC3:SSC.POS", "only tagged drafts are read and unreadable drafts are reported");
        Check(DraftReview.FindBetween(new [] {Line(0,2,2,0)},existing.Segments).Count==1,"prior draft geometry participates in crossing review");
        page=new FakePage{FailAt=3}; app=new FakeApp{Page=page}; bool failed=false;
        try { DraftRenderer.Draw(app,page,plan); } catch(InvalidOperationException) { failed=true; }
        Check(failed && page.Shapes.Count==0 && !app.Committed && app.Ends==1,"drawing error rolls back partial changes");
        return 0;
    }
}
