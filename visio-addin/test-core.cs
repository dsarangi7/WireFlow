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
public sealed class FakeId { public int ID { get; set; } }
public sealed class FakeMarkerPage { public FakeId PageSheet { get; set; } }
public sealed class FakeMarker { public object ContainingPage { get; set; } public FakeId ContainingShape { get; set; } public FakeCells CellsU=new FakeCells(); }
public sealed class FakePage {
    public readonly List<FakeShape> Shapes = new List<FakeShape>();
    public int FailAt = -1; public int Polylines; public double[] LastPolyline;
    public FakeShape DrawLine(double x1,double y1,double x2,double y2) {
        if (Shapes.Count == FailAt) throw new InvalidOperationException("Simulated draw failure");
        var shape = new FakeShape(); Shapes.Add(shape); return shape;
    }
    public FakeShape DrawPolyline(ref double[] xy,short flags) { if(flags!=8 || xy.Length<6) throw new Exception("Invalid polyline"); Polylines++; LastPolyline=(double[])xy.Clone(); return DrawLine(xy[0],xy[1],xy[xy.Length-2],xy[xy.Length-1]); }
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
        foreach(var contract in new [] { typeof(IDTExtensibility2), typeof(IRibbonExtensibility) }) {
            var kind=(System.Runtime.InteropServices.InterfaceTypeAttribute)Attribute.GetCustomAttribute(contract,typeof(System.Runtime.InteropServices.InterfaceTypeAttribute));
            Check(kind!=null && kind.Value==System.Runtime.InteropServices.ComInterfaceType.InterfaceIsDual,"Office contract exposes its required dual COM vtable: "+contract.Name);
        }
        var sink=new PageMouseSink(); var expectedPage=new object(); int captured=0; double clickedX=0, clickedY=0;
        sink.SetHandlers((p,x,y)=> { if (!Object.ReferenceEquals(p,expectedPage)) return false; captured++; clickedX=x; clickedY=y; return true; }, message => { throw new Exception(message); });
        var mouse=new FakeMouseEvent{Button=1,x=3.5,y=4.25,Window=new FakeMouseWindow{Page=expectedPage}};
        Check((bool)sink.VisEventProc(709,null,0,0,mouse,null) && captured==1 && clickedX==3.5 && clickedY==4.25,"left click delivers exact internal drawing coordinates and suppresses default");
        mouse.Button=2; Check(!(bool)sink.VisEventProc(709,null,0,0,mouse,null) && captured==1,"right click does not capture or suppress default");
        mouse.Button=1; mouse.Window.Page=new object(); Check(!(bool)sink.VisEventProc(709,null,0,0,mouse,null) && captured==1,"click on another page remains untouched");
        Check(!(bool)sink.VisEventProc(710,null,0,0,mouse,null),"mouse move is not treated as a port click");
        var templatePlan=new DraftPlan { Modules=3 };
        templatePlan.Set("M1.S",9,9); templatePlan.Set("M1.N",9.5,9); templatePlan.Set("M1.NEG",10.5,9); templatePlan.Set("M1.POS",11,9);
        bool sameCentre=false; try { ModuleTemplate.CopyPorts(templatePlan,new Point(10,10),new Point(10,10),2); } catch(InvalidOperationException) { sameCentre=true; }
        Check(sameCentre && templatePlan.Terminals.Count==4,"duplicate template positions are rejected without partially marking the next module");
        ModuleTemplate.CopyPorts(templatePlan,new Point(10,10),new Point(20,20),2);
        Check(templatePlan.Terminals["M2.S"].X==19 && templatePlan.Terminals["M2.S"].Y==19 && templatePlan.Terminals["M2.POS"].X==21 && templatePlan.Terminals["M2.POS"].Y==19,"template translates measured ports from the M1 centre to the next module centre");
        bool repeat=false; try { ModuleTemplate.CopyPorts(templatePlan,new Point(10,10),new Point(30,30),2); } catch(InvalidOperationException) { repeat=true; }
        Check(repeat && templatePlan.Terminals["M2.S"].X==19,"an already marked module cannot be silently overwritten");
        var missingTemplate=new DraftPlan { Modules=2 }; missingTemplate.Set("M1.S",9,9);
        bool missingPort=false; try { ModuleTemplate.CopyPorts(missingTemplate,new Point(10,10),new Point(20,20),2); } catch(InvalidOperationException) { missingPort=true; }
        Check(missingPort && missingTemplate.Terminals.Count==1,"all reference ports are required before any copied ports are recorded");
        var markerPage=new FakeMarkerPage { PageSheet=new FakeId { ID=0 } };
        var marker=new FakeMarker { ContainingPage=markerPage, ContainingShape=new FakeId { ID=0 } };
        marker.CellsU["PinX"].ResultIU=1.25; marker.CellsU["PinY"].ResultIU=2.5;
        var markerPoint=MarkerCoordinates.Read(marker,markerPage);
        Check(markerPoint.X==1.25 && markerPoint.Y==2.5,"top-level marker coordinates are read on the expected page");
        marker.ContainingShape.ID=8; bool nestedRejected=false; try { MarkerCoordinates.Read(marker,markerPage); } catch(InvalidOperationException) { nestedRejected=true; }
        Check(nestedRejected,"nested group markers are rejected before parent-relative coordinates can be used");
        marker.ContainingShape.ID=0; bool pageRejected=false; try { MarkerCoordinates.Read(marker,new FakeMarkerPage { PageSheet=new FakeId { ID=0 } }); } catch(InvalidOperationException) { pageRejected=true; }
        Check(pageRejected,"markers on another page are rejected even when page-sheet IDs match");
        Check(DraftReview.Intersects(Line(0,0,2,2),Line(0,2,2,0)),"interior crossing is reported");
        Check(!DraftReview.Intersects(Line(0,0,1,1),Line(1,1,2,0)),"shared endpoints are not reported as crossing");
        Check(DraftReview.Intersects(Line(0,0,2,0),Line(1,0,1,1)),"endpoint touching another segment interior is reported");
        Check(DraftReview.Intersects(Line(0,0,2,0),Line(1,0,3,0)),"collinear overlapping lines are reported");
        Check(!DraftReview.Intersects(Line(0,0,1,0),Line(1,0,2,0)),"collinear lines meeting at one endpoint are not reported");
        Check(!DraftReview.Intersects(Line(0,0,1,0),Line(0,1,1,1)) && !DraftReview.Intersects(Line(0,0,1,0),Line(2,0,3,0)),"parallel and separated lines are not reported");
        Check(DraftReview.FindCrossings(new [] {Line(0,0,2,2),Line(0,2,2,0),Line(3,3,4,4)}).Count==1,"crossing review counts each wire pair once");
        Check(DraftReview.FindBetween(new [] {Line(0,0,2,2)},new [] {Line(0,2,2,0),Line(3,3,4,4)}).Count==1,"crossings against other SSC draft wires are checked");
        var routed=Line(0,0,2,0); routed.Waypoints=new List<Point>{new Point(1,1)};
        Check(DraftReview.Intersects(routed,Line(1,.75,1,1.25)),"crossing check examines waypoint segments, not only their chord");
        var selfCross=Line(0,0,2,0); selfCross.Waypoints=new List<Point>{new Point(2,2),new Point(0,2)};
        Check(DraftReview.FindCrossings(new [] {selfCross}).Count==1,"self-crossing in one routed wire is reported");
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
        var partial=new DraftPlan{Modules=2,Bank=2,Ssc=3,JunctionBox=5}; for(int i=0;i<5;i++) partial.Set(order[i],i+1,i+1);
        var serialized=MarkPersistence.Serialize(partial,@"G:\\sample.vsdx",42,5);
        var restored=MarkPersistence.Deserialize(serialized,@"g:\\sample.vsdx",42,out restoredCount);
        Check(restoredCount==5 && restored.Modules==2 && restored.Bank==2 && restored.Ssc==3 && restored.JunctionBox==5 && restored.Terminals[order[4]].X==5,"partial marks and chain identities round trip for the original drawing and page");
        string oldV2=serialized.Replace("\"Version\":4", "\"Version\":2");
        bool needsJb=false; try { MarkPersistence.Deserialize(oldV2,@"G:\\sample.vsdx",42,out restoredCount); } catch(InvalidOperationException) { needsJb=true; }
        Check(needsJb,"legacy sessions require an explicitly confirmed junction box");
        var legacyV2=MarkPersistence.Deserialize(oldV2,@"G:\\sample.vsdx",42,7,out restoredCount);
        Check(restoredCount==5 && legacyV2.Routes.Count==0 && legacyV2.Ssc==3 && legacyV2.JunctionBox==7,"version 2 sessions accept explicit junction box without invented routes");
        bool differentPage=false; try { MarkPersistence.Deserialize(serialized,@"G:\\sample.vsdx",43,out restoredCount); } catch(InvalidOperationException) { differentPage=true; }
        Check(differentPage,"marks cannot be loaded onto a different page");
        bool differentFile=false; try { MarkPersistence.Deserialize(serialized,@"G:\\other.vsdx",42,out restoredCount); } catch(InvalidOperationException) { differentFile=true; }
        Check(differentFile,"marks cannot be loaded into a different drawing");
        bool malformed=false; try { MarkPersistence.Deserialize(serialized.Replace("SSC.S", "M2.POS"),@"G:\\sample.vsdx",42,out restoredCount); } catch(InvalidOperationException) { malformed=true; }
        Check(malformed,"out-of-order marking files are rejected");
        bool oldVersion=false; try { MarkPersistence.Deserialize(serialized.Replace("\"Version\":4", "\"Version\":1"),@"G:\\sample.vsdx",42,out restoredCount); } catch(InvalidOperationException) { oldVersion=true; }
        Check(oldVersion,"old mark files without verified bank and SSC identity are rejected");
        plan.Bank=2; plan.Ssc=3; plan.JunctionBox=5;
        plan.SetRoute("SSC.POS","M1.POS",new [] {new Point(20,21),new Point(22,23)});
        var routeFile=MarkPersistence.Serialize(plan,@"G:\\sample.vsdx",42,order.Count);
        var restoredRoute=MarkPersistence.Deserialize(routeFile,@"G:\\sample.vsdx",42,out restoredCount);
        Check(restoredRoute.Routes[DraftPlan.RouteKey("SSC.POS","M1.POS")].Count==2 && restoredRoute.Routes[DraftPlan.RouteKey("SSC.POS","M1.POS")][0].X==20,"manual waypoints round trip in their original order");
        var legacyV3=MarkPersistence.Deserialize(routeFile.Replace("\"Version\":4", "\"Version\":3"),@"G:\\sample.vsdx",42,8,out restoredCount);
        Check(legacyV3.JunctionBox==8 && legacyV3.Routes[DraftPlan.RouteKey("SSC.POS","M1.POS")].Count==2,"version 3 routes load with an explicitly assigned junction box");
        string preview=DraftReview.FormatPreview(restoredRoute);
        Check(preview.Contains("Bank 2") && preview.Contains("SSC 3") && preview.Contains("junction box 5") && preview.Contains("SSC.POS\tM1.POS") && preview.Contains("20,21 → 22,23") && preview.Contains("DRAFT"),"preview lists chain identity, endpoints and manual route points as draft");
        bool wrongRoute=false; try { plan.SetRoute("M2.POS","SSC.POS",new [] {new Point(20,21)}); } catch(InvalidOperationException) { wrongRoute=true; }
        Check(wrongRoute,"routes cannot be attached to an unlisted connection");
        var page=new FakePage(); var app=new FakeApp{Page=page};
        var incomplete=new DraftPlan{Modules=2}; bool rejected=false;
        try { DraftRenderer.Draw(app,page,incomplete); } catch(InvalidOperationException) { rejected=true; }
        Check(rejected && page.Shapes.Count==0 && app.Starts==0,"incomplete terminals are rejected before page changes");
        Check(DraftRenderer.Draw(app,page,plan)==8 && page.Shapes.Count==8 && app.Committed && app.Ends==1,"valid plan draws once within one undo scope");
        Check(page.Polylines==1 && page.LastPolyline.Length==8 && page.LastPolyline[2]==20 && page.LastPolyline[4]==22,"manual route is one editable polyline with exact waypoints");
        Check(page.Shapes[0].CellsU["LineColor"].FormulaU=="RGB(255,0,0)" && page.Shapes[1].CellsU["LineColor"].FormulaU=="RGB(0,176,80)","draft power and communication colours");
        Check(page.Shapes[0].CellsU["User.WireFlowFrom.Value"].FormulaU=="\"SSC.POS\"" && page.Shapes[0].CellsU["User.WireFlowTo.Value"].FormulaU=="\"M1.POS\"" && page.Shapes[0].CellsU["User.WireFlowStatus.Value"].FormulaU=="\"DRAFT\"" && page.Shapes[0].CellsU["User.WireFlowBank.Value"].FormulaU=="\"2\"" && page.Shapes[0].CellsU["User.WireFlowSSC.Value"].FormulaU=="\"3\"" && page.Shapes[0].CellsU["User.WireFlowJB.Value"].FormulaU=="\"5\"", "every generated shape carries explicit chain identities and draft endpoint metadata");
        var reading=new FakeReadPage(); reading.Shapes.Items.Add(new FakeShape());
        var routedTagged=page.Shapes[0]; reading.Shapes.Items.Add(routedTagged);
        var tagged=page.Shapes[1]; tagged.CellsU["BeginX"].ResultIU=0; tagged.CellsU["BeginY"].ResultIU=0; tagged.CellsU["EndX"].ResultIU=2; tagged.CellsU["EndY"].ResultIU=2; reading.Shapes.Items.Add(tagged);
        var broken=new FakeShape(); broken.CellsU["User.WireFlowStatus.Value"].FormulaU="\"DRAFT\""; reading.Shapes.Items.Add(broken);
        var existing=DraftReview.ReadExisting(reading);
        Check(existing.Segments.Count==1 && existing.Unreadable==2 && existing.Segments[0].From=="B2/SSC3:SSC.S", "routed and incomplete draft geometry is flagged for manual review");
        Check(DraftReview.HasChain(existing,2,3) && !DraftReview.HasChain(existing,2,4) && !DraftReview.HasChain(existing,1,3),"existing chain guard distinguishes bank and SSC identities");
        Check(DraftReview.FindBetween(new [] {Line(0,2,2,0)},existing.Segments).Count==1,"prior draft geometry participates in crossing review");
        page=new FakePage{FailAt=3}; app=new FakeApp{Page=page}; bool failed=false;
        try { DraftRenderer.Draw(app,page,plan); } catch(InvalidOperationException) { failed=true; }
        Check(failed && page.Shapes.Count==0 && !app.Committed && app.Ends==1,"drawing error rolls back partial changes");
        return 0;
    }
}
