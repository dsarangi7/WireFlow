using System;
using System.Collections.Generic;
using Ayk.WireFlow.VisioAddIn;

public sealed class FakeCell { public string FormulaU { get; set; } }
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
public sealed class FakeApp {
    public FakePage Page; public int Starts, Ends; public bool Committed; private int before;
    public int BeginUndoScope(string name) { Starts++; before=Page.Shapes.Count; return 1; }
    public void EndUndoScope(int id, bool commit) { Ends++; Committed=commit; if (!commit) Page.Shapes.RemoveRange(before,Page.Shapes.Count-before); }
}
public static class TestCore {
    private static void Check(bool condition,string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); }
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
        var partial=new DraftPlan{Modules=2}; for(int i=0;i<5;i++) partial.Set(order[i],i+1,i+1);
        var serialized=MarkPersistence.Serialize(partial,@"G:\\sample.vsdx",42,5);
        var restored=MarkPersistence.Deserialize(serialized,@"g:\\sample.vsdx",42,out restoredCount);
        Check(restoredCount==5 && restored.Modules==2 && restored.Terminals[order[4]].X==5,"partial terminal markings round trip in order for the original drawing and page");
        bool differentPage=false; try { MarkPersistence.Deserialize(serialized,@"G:\\sample.vsdx",43,out restoredCount); } catch(InvalidOperationException) { differentPage=true; }
        Check(differentPage,"marks cannot be loaded onto a different page");
        bool differentFile=false; try { MarkPersistence.Deserialize(serialized,@"G:\\other.vsdx",42,out restoredCount); } catch(InvalidOperationException) { differentFile=true; }
        Check(differentFile,"marks cannot be loaded into a different drawing");
        bool malformed=false; try { MarkPersistence.Deserialize(serialized.Replace("SSC.S", "M2.POS"),@"G:\\sample.vsdx",42,out restoredCount); } catch(InvalidOperationException) { malformed=true; }
        Check(malformed,"out-of-order marking files are rejected");
        var page=new FakePage(); var app=new FakeApp{Page=page};
        var incomplete=new DraftPlan{Modules=2}; bool rejected=false;
        try { DraftRenderer.Draw(app,page,incomplete); } catch(InvalidOperationException) { rejected=true; }
        Check(rejected && page.Shapes.Count==0 && app.Starts==0,"incomplete terminals are rejected before page changes");
        Check(DraftRenderer.Draw(app,page,plan)==8 && page.Shapes.Count==8 && app.Committed && app.Ends==1,"valid plan draws once within one undo scope");
        Check(page.Shapes[0].CellsU["LineColor"].FormulaU=="RGB(255,0,0)" && page.Shapes[1].CellsU["LineColor"].FormulaU=="RGB(0,176,80)","draft power and communication colours");
        Check(page.Shapes[0].CellsU["User.WireFlowFrom.Value"].FormulaU=="\"SSC.POS\"" && page.Shapes[0].CellsU["User.WireFlowTo.Value"].FormulaU=="\"M1.POS\"" && page.Shapes[0].CellsU["User.WireFlowStatus.Value"].FormulaU=="\"DRAFT\"", "every generated shape carries explicit draft endpoint metadata");
        page=new FakePage{FailAt=3}; app=new FakeApp{Page=page}; bool failed=false;
        try { DraftRenderer.Draw(app,page,plan); } catch(InvalidOperationException) { failed=true; }
        Check(failed && page.Shapes.Count==0 && !app.Committed && app.Ends==1,"drawing error rolls back partial changes");
        return 0;
    }
}
