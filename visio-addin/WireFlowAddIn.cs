// Prototype desktop COM add-in. Engineers explicitly mark every terminal.
// Wires are draft straight lines; engineering must approve routes and harnesses.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.IO;
using System.Web.Script.Serialization;

namespace Ayk.WireFlow.VisioAddIn {
    [ComVisible(true), Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IDTExtensibility2 {
        [DispId(1)] void OnConnection([MarshalAs(UnmanagedType.IDispatch)] object application, int connectMode, [MarshalAs(UnmanagedType.IDispatch)] object addInInst, ref Array custom);
        [DispId(2)] void OnDisconnection(int removeMode, ref Array custom);
        [DispId(3)] void OnAddInsUpdate(ref Array custom);
        [DispId(4)] void OnStartupComplete(ref Array custom);
        [DispId(5)] void OnBeginShutdown(ref Array custom);
    }
    [ComVisible(true), Guid("000C0396-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IRibbonExtensibility { [DispId(1)] string GetCustomUI(string ribbonId); }
    [ComVisible(true), Guid("A93A0C27-8C7C-4A96-B777-67DA7B92D10D"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IWireFlowCallbacks { [DispId(1)] void OpenWorkspace([MarshalAs(UnmanagedType.IDispatch)] object control); }

    [ComVisible(true), Guid("E1CE7134-5A5D-4B05-BC55-93BF487456CB"), ProgId("AYK.WireFlow.VisioAddIn"), ClassInterface(ClassInterfaceType.None), ComDefaultInterface(typeof(IWireFlowCallbacks))]
    public sealed class WireFlowAddIn : IDTExtensibility2, IRibbonExtensibility, IWireFlowCallbacks {
        private object host;
        private WorkspaceForm form;
        public void OnConnection(object application, int connectMode, object addInInst, ref Array custom) { host = application; }
        public void OnDisconnection(int removeMode, ref Array custom) { if (form != null) form.Close(); form = null; host = null; }
        public void OnAddInsUpdate(ref Array custom) { }
        public void OnStartupComplete(ref Array custom) { }
        public void OnBeginShutdown(ref Array custom) { if (form != null) form.Close(); }
        public string GetCustomUI(string ribbonId) {
            return "<customUI xmlns=\"http://schemas.microsoft.com/office/2006/01/customui\"><ribbon><tabs><tab id=\"aykWireFlow\" label=\"AYK WireFlow\"><group id=\"aykDraft\" label=\"Draft wiring\"><button id=\"aykOpen\" label=\"Open WireFlow\" size=\"large\" onAction=\"OpenWorkspace\"/></group></tab></tabs></ribbon></customUI>";
        }
        public void OpenWorkspace(object control) {
            try { if (host == null) throw new InvalidOperationException("Connect to Visio first."); if (form == null || form.IsDisposed) form = new WorkspaceForm(host); form.Show(); form.Activate(); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "AYK WireFlow", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
    }

    public sealed class Point { public double X; public double Y; public Point(double x, double y) { if (Double.IsNaN(x) || Double.IsInfinity(x) || Double.IsNaN(y) || Double.IsInfinity(y)) throw new ArgumentException("Invalid terminal coordinates."); X=x; Y=y; } }
    public sealed class Segment { public string Network; public string From; public string To; public Point A; public Point B; public int Bank; public int Ssc; public List<Point> Waypoints; }
    public sealed class Crossing { public Segment First; public Segment Second; }
    public sealed class ExistingDrafts { public readonly List<Segment> Segments=new List<Segment>(); public readonly HashSet<string> Identities=new HashSet<string>(); public int Unreadable; }
    public static class DraftReview {
        private static string Literal(object formula) {
            string value=formula as string;
            if (value == null || value.Length < 2 || value[0] != '"' || value[value.Length-1] != '"') throw new InvalidOperationException("The draft annotation is not a literal.");
            return value.Substring(1,value.Length-2).Replace("\"\"","\"");
        }
        public static ExistingDrafts ReadExisting(object page) {
            dynamic pg=page; var found=new ExistingDrafts();
            int count=(int)pg.Shapes.Count;
            for (int i=1;i<=count;i++) {
                dynamic shape=pg.Shapes[i];
                // Other shapes are normal on the rack picture. Only inspect a
                // shape if it has our explicitly tagged draft-status cell.
                string status;
                try { status=Literal((object)shape.CellsU["User.WireFlowStatus.Value"].FormulaU); }
                catch { continue; }
                if (status != "DRAFT") continue;
                try {
                    string bank=Literal((object)shape.CellsU["User.WireFlowBank.Value"].FormulaU);
                    string ssc=Literal((object)shape.CellsU["User.WireFlowSSC.Value"].FormulaU);
                    string from=Literal((object)shape.CellsU["User.WireFlowFrom.Value"].FormulaU);
                    string to=Literal((object)shape.CellsU["User.WireFlowTo.Value"].FormulaU);
                    string network=Literal((object)shape.CellsU["User.WireFlowNetwork.Value"].FormulaU);
                    int bankId,sscId;
                    if (!Int32.TryParse(bank,NumberStyles.None,CultureInfo.InvariantCulture,out bankId) || bankId < 1 || bankId > 9999 || !Int32.TryParse(ssc,NumberStyles.None,CultureInfo.InvariantCulture,out sscId) || sscId < 1 || sscId > 9999) throw new InvalidOperationException("Invalid draft identity.");
                    if (network != "POWER" && network != "COMM") throw new InvalidOperationException("Unknown draft network.");
                    found.Identities.Add(bankId+":"+sscId);
                    string routeMode="STRAIGHT";
                    try { routeMode=Literal((object)shape.CellsU["User.WireFlowRoute.Value"].FormulaU); } catch { }
                    if(routeMode!="STRAIGHT") throw new InvalidOperationException("Routed draft requires geometric inspection.");
                    found.Segments.Add(new Segment { Network=network, Bank=bankId, Ssc=sscId, From="B"+bank+"/SSC"+ssc+":"+from, To=to,
                        A=new Point((double)shape.CellsU["BeginX"].ResultIU,(double)shape.CellsU["BeginY"].ResultIU),
                        B=new Point((double)shape.CellsU["EndX"].ResultIU,(double)shape.CellsU["EndY"].ResultIU) });
                } catch { found.Unreadable++; }
            }
            return found;
        }
        public static bool HasChain(ExistingDrafts drafts, int bank, int ssc) {
            return drafts.Identities.Contains(bank+":"+ssc);
        }
        private static double Cross(double ax,double ay,double bx,double by) { return ax*by-ay*bx; }
        private static bool Same(Point a, Point b, double e) { return Math.Abs(a.X-b.X)<=e && Math.Abs(a.Y-b.Y)<=e; }
        private static bool StraightIntersects(Segment a, Segment b) {
            // This is only a two-dimensional line-overlap warning, in Visio's
            // internal drawing units; it is not a physical clearance check.
            double ux=a.B.X-a.A.X, uy=a.B.Y-a.A.Y, vx=b.B.X-b.A.X, vy=b.B.Y-b.A.Y;
            double al=Math.Sqrt(ux*ux+uy*uy), bl=Math.Sqrt(vx*vx+vy*vy);
            if (al==0 || bl==0) return false;
            double e=1e-9*Math.Max(1,Math.Max(al,bl));
            double wx=b.A.X-a.A.X, wy=b.A.Y-a.A.Y;
            double denominator=Cross(ux,uy,vx,vy);
            if (Math.Abs(denominator)<=e*Math.Max(al,bl)) {
                if (Math.Abs(Cross(wx,wy,ux,uy))>e*al) return false;
                // Collinear overlap is distinct from a single shared endpoint.
                double t0=(wx*ux+wy*uy)/(al*al), t1=((b.B.X-a.A.X)*ux+(b.B.Y-a.A.Y)*uy)/(al*al);
                return Math.Min(1,Math.Max(t0,t1))-Math.Max(0,Math.Min(t0,t1)) > e/al;
            }
            double t=Cross(wx,wy,vx,vy)/denominator, u=Cross(wx,wy,ux,uy)/denominator;
            double tolA=e/al, tolB=e/bl;
            if (t < -tolA || t > 1+tolA || u < -tolB || u > 1+tolB) return false;
            if (Same(a.A,b.A,e) || Same(a.A,b.B,e) || Same(a.B,b.A,e) || Same(a.B,b.B,e)) return false;
            return true;
        }
        private static List<Segment> Parts(Segment s) {
            var points=new List<Point>(); points.Add(s.A); if(s.Waypoints!=null) points.AddRange(s.Waypoints); points.Add(s.B);
            var parts=new List<Segment>(); for(int i=1;i<points.Count;i++) parts.Add(new Segment { A=points[i-1], B=points[i] }); return parts;
        }
        public static bool Intersects(Segment a, Segment b) {
            foreach(var x in Parts(a)) foreach(var y in Parts(b)) if(StraightIntersects(x,y)) return true;
            return false;
        }
        public static List<Crossing> FindCrossings(IList<Segment> segments) {
            var found=new List<Crossing>();
            for(int i=0;i<segments.Count;i++) {
                var parts=Parts(segments[i]); bool self=false;
                for(int a=0;a<parts.Count && !self;a++) for(int b=a+1;b<parts.Count;b++) if(StraightIntersects(parts[a],parts[b])) { self=true; break; }
                if(self) found.Add(new Crossing { First=segments[i],Second=segments[i] });
                for(int j=i+1;j<segments.Count;j++) if (Intersects(segments[i],segments[j])) found.Add(new Crossing { First=segments[i],Second=segments[j] });
            }
            return found;
        }
        public static List<Crossing> FindBetween(IList<Segment> proposed,IList<Segment> existing) {
            var found=new List<Crossing>();
            foreach(var a in proposed) foreach(var b in existing) if(Intersects(a,b)) found.Add(new Crossing { First=a,Second=b });
            return found;
        }
    }
    // Visio's AddAdvise accepts an IDispatch sink. Mouse coordinates arrive in
    // Visio internal drawing units; confirmation against real zoom/pan is pending.
    [ComVisible(true), Guid("F00478F4-2CB1-426E-BB77-0A873DDC81CD"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IPageMouseSink {
        [DispId(1)] object VisEventProc(short code, object source, int eventId, int sequence, object subject, object moreInfo);
    }
    [ComVisible(true), ClassInterface(ClassInterfaceType.None), ComDefaultInterface(typeof(IPageMouseSink))]
    public sealed class PageMouseSink : IPageMouseSink {
        private Func<object,double,double,bool> accept;
        private Action<string> error;
        [ComVisible(false)] public void SetHandlers(Func<object,double,double,bool> onPoint, Action<string> onError) { accept=onPoint; error=onError; }
        public object VisEventProc(short code, object source, int eventId, int sequence, object subject, object moreInfo) {
            if (code != 709 || accept == null || subject == null) return false;
            try {
                dynamic mouse=subject;
                if ((int)mouse.Button != 1) return false;
                object eventPage=mouse.Window.Page;
                return accept(eventPage, (double)mouse.x, (double)mouse.y);
            } catch(Exception ex) { if (error != null) error(ex.Message); return false; }
        }
    }
    public sealed class DraftPlan {
        public readonly Dictionary<string, Point> Terminals = new Dictionary<string, Point>();
        public readonly Dictionary<string, List<Point>> Routes = new Dictionary<string, List<Point>>();
        public int Modules;
        public int Bank = 1;
        public int Ssc = 1;
        public void Set(string name, double x, double y) {
            var point = new Point(x,y);
            foreach (var entry in Terminals) if (entry.Key != name && entry.Value.X == x && entry.Value.Y == y) throw new InvalidOperationException("This marker is already assigned to " + entry.Key + ". Select a different terminal marker.");
            Terminals[name] = point;
        }
        public bool Remove(string name) { return Terminals.Remove(name); }
        public static string RouteKey(string from,string to) { return from+">"+to; }
        public void SetRoute(string from,string to,IList<Point> points) {
            if(points==null || points.Count>20) throw new InvalidOperationException("Use no more than 20 waypoints per connection.");
            var segment=Build().Find(s => s.From==from && s.To==to);
            if(segment==null) throw new InvalidOperationException("The selected connection is not part of this chain.");
            var copy=new List<Point>(); Point previous=segment.A;
            foreach(var p in points) {
                if(p==null) throw new InvalidOperationException("A waypoint is missing.");
                var point=new Point(p.X,p.Y);
                if(point.X==previous.X && point.Y==previous.Y) throw new InvalidOperationException("Consecutive route points must differ.");
                copy.Add(point); previous=point;
            }
            if(copy.Count>0 && previous.X==segment.B.X && previous.Y==segment.B.Y) throw new InvalidOperationException("The last waypoint duplicates the end terminal.");
            string key=RouteKey(from,to); if(copy.Count==0) Routes.Remove(key); else Routes[key]=copy;
        }
        private Point Require(string key) { Point p; if (!Terminals.TryGetValue(key, out p)) throw new InvalidOperationException("Missing terminal: " + key); return p; }
        private Segment Connect(string network, string a, string b) { return new Segment { Network=network, Bank=Bank, Ssc=Ssc, From=a, To=b, A=Require(a), B=Require(b) }; }
        public List<Segment> Build() {
            if (Modules < 2 || Modules > 48) throw new InvalidOperationException("Enter 2 to 48 modules in the chain.");
            if (Bank < 1 || Bank > 9999 || Ssc < 1 || Ssc > 9999) throw new InvalidOperationException("Enter a valid bank and SSC number.");
            var result = new List<Segment>();
            result.Add(Connect("POWER", "SSC.POS", "M1.POS"));
            result.Add(Connect("COMM", "SSC.S", "M1.N"));
            for (int i=1; i<Modules; i++) {
                result.Add(Connect("POWER", "M"+i+".NEG", "M"+(i+1)+".POS"));
                result.Add(Connect("COMM", "M"+i+".S", "M"+(i+1)+".N"));
            }
            result.Add(Connect("POWER", "SSC.NEG", "M"+Modules+".NEG"));
            result.Add(Connect("COMM", "SSC.N", "M"+Modules+".S"));
            result.Add(Connect("POWER", "SSC.B-", "JB.NEG"));
            result.Add(Connect("POWER", "SSC.B+", "JB.POS"));
            foreach(var segment in result) { List<Point> points; if(Routes.TryGetValue(RouteKey(segment.From,segment.To),out points)) segment.Waypoints=new List<Point>(points); }
            return result;
        }
    }
    public sealed class RoutePoint { public double X { get; set; } public double Y { get; set; } }
    public sealed class RouteEntry { public string From { get; set; } public string To { get; set; } public List<RoutePoint> Points { get; set; } }
    public sealed class MarkEntry { public string Name { get; set; } public double X { get; set; } public double Y { get; set; } }
    public sealed class MarkFile {
        public int Version { get; set; }
        public string DrawingPath { get; set; }
        public int PageId { get; set; }
        public int Modules { get; set; }
        public int Bank { get; set; }
        public int Ssc { get; set; }
        public List<MarkEntry> Marks { get; set; }
        public List<RouteEntry> Routes { get; set; }
    }
    public static class MarkPersistence {
        public static List<string> Steps(int modules) {
            if (modules < 2 || modules > 48) throw new InvalidOperationException("Enter 2 to 48 modules in the chain.");
            var steps = new List<string> { "SSC.S","SSC.N","SSC.NEG","SSC.POS","SSC.B-","SSC.B+","JB.NEG","JB.POS" };
            for (int i=1; i<=modules; i++) foreach (var port in new [] {"S","N","NEG","POS"}) steps.Add("M"+i+"."+port);
            return steps;
        }
        public static string Serialize(DraftPlan plan, string drawingPath, int pageId, int count) {
            var steps=Steps(plan.Modules);
            if (String.IsNullOrWhiteSpace(drawingPath) || pageId < 0 || count < 0 || count > steps.Count || plan.Terminals.Count != count || plan.Bank < 1 || plan.Bank > 9999 || plan.Ssc < 1 || plan.Ssc > 9999) throw new InvalidOperationException("Cannot save an invalid marking session.");
            if(count < steps.Count && plan.Routes.Count>0) throw new InvalidOperationException("Finish terminal marking before saving routes.");
            var file=new MarkFile { Version=3, DrawingPath=Path.GetFullPath(drawingPath), PageId=pageId, Modules=plan.Modules, Bank=plan.Bank, Ssc=plan.Ssc, Marks=new List<MarkEntry>(), Routes=new List<RouteEntry>() };
            for(int i=0;i<count;i++) {
                Point p; if(!plan.Terminals.TryGetValue(steps[i],out p)) throw new InvalidOperationException("Terminal markings must be in order.");
                file.Marks.Add(new MarkEntry { Name=steps[i], X=p.X, Y=p.Y });
            }
            if(plan.Routes.Count>0) foreach(var segment in plan.Build()) if(segment.Waypoints!=null) {
                var route=new RouteEntry { From=segment.From, To=segment.To, Points=new List<RoutePoint>() };
                foreach(var point in segment.Waypoints) route.Points.Add(new RoutePoint { X=point.X,Y=point.Y }); file.Routes.Add(route);
            }
            if(file.Routes.Count!=plan.Routes.Count) throw new InvalidOperationException("A route is not part of this chain.");
            return new JavaScriptSerializer().Serialize(file);
        }
        public static DraftPlan Deserialize(string json, string drawingPath, int pageId, out int count) {
            if (json == null || json.Length > 1048576 || String.IsNullOrWhiteSpace(drawingPath)) throw new InvalidOperationException("The marking file or active drawing is invalid.");
            var file=new JavaScriptSerializer().Deserialize<MarkFile>(json);
            if (file == null || (file.Version != 2 && file.Version != 3) || file.Bank < 1 || file.Bank > 9999 || file.Ssc < 1 || file.Ssc > 9999) throw new InvalidOperationException("This marking file is missing a valid bank and SSC identity. Mark the terminals again.");
            if (String.IsNullOrWhiteSpace(file.DrawingPath) || file.PageId != pageId || !String.Equals(Path.GetFullPath(file.DrawingPath),Path.GetFullPath(drawingPath),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("This marking file belongs to another drawing or page.");
            var steps=Steps(file.Modules);
            if (file.Marks == null || file.Marks.Count > steps.Count) throw new InvalidOperationException("The marking file has invalid entries.");
            var plan=new DraftPlan { Modules=file.Modules, Bank=file.Bank, Ssc=file.Ssc };
            for(int i=0;i<file.Marks.Count;i++) {
                var mark=file.Marks[i]; if(mark == null || mark.Name != steps[i]) throw new InvalidOperationException("The marking file is not in the required order.");
                plan.Set(mark.Name,mark.X,mark.Y);
            }
            if(file.Version==3) {
                if(file.Routes==null || file.Routes.Count>2*file.Modules+4 || (file.Routes.Count>0 && file.Marks.Count!=steps.Count)) throw new InvalidOperationException("The saved routes are incomplete or invalid.");
                var seen=new HashSet<string>();
                foreach(var route in file.Routes) {
                    if(route==null || route.From==null || route.To==null || route.Points==null || route.Points.Count==0 || !seen.Add(DraftPlan.RouteKey(route.From,route.To))) throw new InvalidOperationException("A saved route is invalid or duplicated.");
                    var points=new List<Point>(); foreach(var p in route.Points) { if(p==null) throw new InvalidOperationException("A waypoint is missing."); points.Add(new Point(p.X,p.Y)); }
                    plan.SetRoute(route.From,route.To,points);
                }
            }
            count=file.Marks.Count; return plan;
        }
    }
    public static class DraftRenderer {
        private static void WriteMetadata(dynamic shape, Segment segment, DraftPlan plan) {
            // User cells are editable annotations, not electrical validation.
            shape.AddSection((short)242); // visSectionUser
            string[] keys={"WireFlowFrom","WireFlowTo","WireFlowNetwork","WireFlowStatus","WireFlowBank","WireFlowSSC","WireFlowRoute"};
            string[] values={segment.From,segment.To,segment.Network,"DRAFT",plan.Bank.ToString(CultureInfo.InvariantCulture),plan.Ssc.ToString(CultureInfo.InvariantCulture),segment.Waypoints==null ? "STRAIGHT" : "WAYPOINTS"};
            for(int i=0;i<keys.Length;i++) {
                shape.AddNamedRow((short)242,keys[i],(short)0);
                shape.CellsU["User."+keys[i]+".Value"].FormulaU="\""+values[i].Replace("\"","\"\"")+"\"";
            }
        }
        public static int Draw(object application, object page, DraftPlan plan) {
            // Validate all endpoints before touching the page. Undo scope rolls back a partial failure.
            var segments = plan.Build();
            dynamic app = application; dynamic pg = page;
            int scope = app.BeginUndoScope("AYK WireFlow draft wiring");
            try {
                foreach (var segment in segments) {
                    dynamic shape;
                    if(segment.Waypoints==null) shape=pg.DrawLine(segment.A.X, segment.A.Y, segment.B.X, segment.B.Y);
                    else {
                        var points=new List<Point>(); points.Add(segment.A); points.AddRange(segment.Waypoints); points.Add(segment.B);
                        double[] xy=new double[points.Count*2]; for(int i=0;i<points.Count;i++) { xy[i*2]=points[i].X; xy[i*2+1]=points[i].Y; }
                        shape=pg.DrawPolyline(ref xy,(short)8); // visPolyline1D
                    }
                    shape.CellsU["LineColor"].FormulaU = segment.Network == "POWER" ? "RGB(255,0,0)" : "RGB(0,176,80)";
                    shape.CellsU["LineWeight"].FormulaU = "0.012 in";
                    shape.Text = "";
                    WriteMetadata(shape,segment,plan);
                }
                app.EndUndoScope(scope, true); return segments.Count;
            } catch { app.EndUndoScope(scope, false); throw; }
        }
    }

    internal sealed class WorkspaceForm : Form {
        private sealed class RouteOption { public string From; public string To; public string Network; public override string ToString() { return Network+" · "+From+" → "+To; } }
        private readonly dynamic app;
        private readonly DraftPlan plan = new DraftPlan();
        private readonly NumericUpDown count = new NumericUpDown { Minimum=2, Maximum=48, Value=12, Width=70 };
        private readonly NumericUpDown bank = new NumericUpDown { Minimum=1, Maximum=9999, Value=1, Width=70 };
        private readonly NumericUpDown ssc = new NumericUpDown { Minimum=1, Maximum=9999, Value=1, Width=70 };
        private readonly Label status = new Label { AutoSize=false, Width=520, Height=92 };
        private readonly Button mark = new Button { Text="Record selected terminal marker", Width=245, Height=40 };
        private readonly Button undo = new Button { Text="Undo last terminal mark", Width=245, Height=36 };
        private readonly Button saveMarks = new Button { Text="Save terminal marks", Width=245, Height=36 };
        private readonly Button loadMarks = new Button { Text="Load terminal marks", Width=245, Height=36 };
        private readonly ComboBox routeChoice = new ComboBox { Width=480, DropDownStyle=ComboBoxStyle.DropDownList };
        private readonly Button addWaypoint = new Button { Text="Add selected route marker", Width=245, Height=36 };
        private readonly Button removeWaypoint = new Button { Text="Remove last route marker", Width=245, Height=36 };
        private readonly Label routeStatus = new Label { Width=510, Height=42 };
        private readonly Button pick = new Button { Text="Click ports on drawing", Width=245, Height=40 };
        private readonly Button draw = new Button { Text="Draw draft on active page", Width=245, Height=40 };
        private readonly List<string> prompts = new List<string>();
        private int next;
        private object page;
        private dynamic mouseEvent;
        private PageMouseSink mouseSink;
        private bool picking;
        public WorkspaceForm(object application) {
            app=application; Text="AYK WireFlow — prototype"; Width=580; Height=540; TopMost=true;
            var layout=new FlowLayoutPanel { Dock=DockStyle.Fill, FlowDirection=FlowDirection.TopDown, Padding=new Padding(12), WrapContents=false, AutoScroll=true };
            var ids=new FlowLayoutPanel { Width=520, Height=34, WrapContents=false };
            ids.Controls.Add(new Label { Text="Bank", AutoSize=true }); ids.Controls.Add(bank);
            ids.Controls.Add(new Label { Text="SSC", AutoSize=true }); ids.Controls.Add(ssc);
            ids.Controls.Add(new Label { Text="Modules", AutoSize=true }); ids.Controls.Add(count); layout.Controls.Add(ids);
            var start=new Button { Text="Start terminal marking", Width=245, Height=36 };
            layout.Controls.Add(start); layout.Controls.Add(status); layout.Controls.Add(pick); layout.Controls.Add(mark); layout.Controls.Add(undo); layout.Controls.Add(saveMarks); layout.Controls.Add(loadMarks);
            layout.Controls.Add(new Label { Text="Optional route waypoints (draft only):", Width=500, Height=22 }); layout.Controls.Add(routeChoice); layout.Controls.Add(routeStatus); layout.Controls.Add(addWaypoint); layout.Controls.Add(removeWaypoint); layout.Controls.Add(draw); Controls.Add(layout);
            start.Click += delegate { StartPlan(); }; mark.Click += delegate { Record(); }; pick.Click += delegate { TogglePicking(); }; undo.Click += delegate { UndoMark(); }; draw.Click += delegate { Draw(); };
            saveMarks.Click += delegate { SaveMarks(); }; loadMarks.Click += delegate { LoadMarks(); };
            routeChoice.SelectedIndexChanged += delegate { ShowRoute(); }; addWaypoint.Click += delegate { AddWaypoint(); }; removeWaypoint.Click += delegate { RemoveWaypoint(); };
            FormClosed += delegate { StopPicking(); };
#if !EXPERIMENTAL_MOUSE_PICKING
            pick.Visible=false;
#endif
            pick.Enabled=false; mark.Enabled=false; undo.Enabled=false; saveMarks.Enabled=false; draw.Enabled=false; routeChoice.Enabled=false; addWaypoint.Enabled=false; removeWaypoint.Enabled=false;
#if EXPERIMENTAL_MOUSE_PICKING
            status.Text="Pilot: mark terminal positions in order, directly on the drawing or by selecting marker shapes.";
#else
            status.Text="Pilot: create and select a small Visio marker shape at each terminal, then record it.";
#endif
        }
        private void StartPlan() {
            try {
                if (next > 0 && MessageBox.Show(this,"Starting a new chain clears the current terminal marks from this window. Save them first if you need to return to them. Continue?","Start a new chain",MessageBoxButtons.YesNo,MessageBoxIcon.Question) != DialogResult.Yes) return;
                StopPicking(); page=app.ActivePage; if (page == null) throw new InvalidOperationException("Open a Visio drawing first.");
                plan.Terminals.Clear(); plan.Routes.Clear(); plan.Modules=(int)count.Value; plan.Bank=(int)bank.Value; plan.Ssc=(int)ssc.Value; prompts.Clear(); next=0;
                prompts.AddRange(MarkPersistence.Steps(plan.Modules));
                // The event sink needs real interactive Visio validation before
                // it can be enabled in a build intended for other users.
#if EXPERIMENTAL_MOUSE_PICKING
                pick.Enabled=true;
#else
                pick.Enabled=false;
#endif
                mark.Enabled=true; undo.Enabled=false; saveMarks.Enabled=true; draw.Enabled=false; DisableRoutes(); ShowPrompt();
            } catch (Exception ex) { status.Text="Could not start: "+ex.Message; }
        }
        private void ShowPrompt() {
            string guidance;
#if EXPERIMENTAL_MOUSE_PICKING
            guidance=picking ? "Click port centres in order. Stop clicking to navigate normally." : "Click ports directly, or select a marker and record it.";
#else
            guidance="Select a marker shape at this port, then click Record.";
#endif
            status.Text="Step "+(next+1)+" of "+prompts.Count+": "+(picking ? "Click " : "Mark ")+prompts[next]+" on the drawing.\n"+guidance;
        }
        private void StopPicking() {
            picking=false; pick.Text="Click ports on drawing";
            if (mouseEvent != null) { try { mouseEvent.Delete(); } catch { } mouseEvent=null; }
            mouseSink=null;
        }
        private void TogglePicking() {
            if (picking) { StopPicking(); ShowPrompt(); return; }
            try {
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                mouseSink=new PageMouseSink();
                mouseSink.SetHandlers(AcceptClick, delegate(string message) { if (!IsDisposed) status.Text="Could not record click: "+message; });
                mouseEvent=app.EventList.AddAdvise((short)709, mouseSink, "", "");
                picking=true; pick.Text="Stop clicking"; ShowPrompt();
            } catch (Exception ex) { StopPicking(); status.Text="Direct clicking is unavailable: "+ex.Message+". Select marker shapes instead."; }
        }
        private bool AcceptClick(object eventPage, double x, double y) {
            if (!picking || page != eventPage || next >= prompts.Count) return false;
            try {
                plan.Set(prompts[next],x,y); next++; undo.Enabled=true;
                if (next == prompts.Count) {
                    picking=false; mark.Enabled=false; pick.Enabled=false; draw.Enabled=true; PopulateRoutes();
                    status.Text="All terminal positions recorded. Draw a draft and review every endpoint and route.";
                    BeginInvoke(new Action(StopPicking));
                } else ShowPrompt();
                return true; // Suppress the default Visio action for a recorded click.
            } catch (Exception ex) { status.Text="Could not record: "+ex.Message; return true; }
        }
        private void UndoMark() {
            if (next == 0) return;
            if (plan.Routes.Count>0 && MessageBox.Show(this,"Changing a terminal clears all manual routes for this chain. Save your marks first if needed. Continue?","Clear manual routes",MessageBoxButtons.YesNo,MessageBoxIcon.Question) != DialogResult.Yes) return;
            StopPicking(); next--; plan.Remove(prompts[next]); plan.Routes.Clear(); DisableRoutes(); mark.Enabled=true; draw.Enabled=false;
#if EXPERIMENTAL_MOUSE_PICKING
            pick.Enabled=true;
#endif
            undo.Enabled=next>0; ShowPrompt();
        }
        private string ActiveDrawingPath() {
            string path=(string)app.ActiveDocument.FullName;
            if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) || !File.Exists(path)) throw new InvalidOperationException("Save the Visio drawing to a local file first.");
            return path;
        }
        private void CheckChainInputs() {
            if ((int)bank.Value != plan.Bank || (int)ssc.Value != plan.Ssc || (int)count.Value != plan.Modules) throw new InvalidOperationException("Bank, SSC or module count changed. Restore the marked values or start a new chain.");
        }
        private void SaveMarks() {
            try {
                if (picking) throw new InvalidOperationException("Stop direct clicking before saving.");
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                CheckChainInputs();
                string json=MarkPersistence.Serialize(plan,ActiveDrawingPath(),(int)((dynamic)page).ID,next);
                using(var dialog=new SaveFileDialog { Filter="WireFlow terminal marks (*.json)|*.json", AddExtension=true, DefaultExt="json" }) {
                    if(dialog.ShowDialog(this) != DialogResult.OK) return;
                    if (!String.Equals(Path.GetExtension(dialog.FileName),".json",StringComparison.OrdinalIgnoreCase) || String.Equals(Path.GetFullPath(dialog.FileName),Path.GetFullPath(ActiveDrawingPath()),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a separate .json file for the terminal marks.");
                    File.WriteAllText(dialog.FileName,json,System.Text.Encoding.UTF8);
                    status.Text="Terminal marks saved. Keep the file with the drawing and verify positions after drawing changes.";
                }
            } catch(Exception ex) { status.Text="Could not save terminal marks: "+ex.Message; }
        }
        private void LoadMarks() {
            try {
                if (picking) throw new InvalidOperationException("Stop direct clicking before loading.");
                object activePage=app.ActivePage; if (activePage == null) throw new InvalidOperationException("Open the matching Visio page first.");
                string drawingPath=ActiveDrawingPath();
                using(var dialog=new OpenFileDialog { Filter="WireFlow terminal marks (*.json)|*.json", CheckFileExists=true }) {
                    if(dialog.ShowDialog(this) != DialogResult.OK) return;
                    var info=new FileInfo(dialog.FileName); if(info.Length > 1048576) throw new InvalidOperationException("The marking file is too large.");
                    int restoredCount;
                    var restored=MarkPersistence.Deserialize(File.ReadAllText(dialog.FileName),drawingPath,(int)((dynamic)activePage).ID,out restoredCount);
                    if(next>0 && MessageBox.Show(this,"Loading this file replaces the current terminal marks and routes in this window. Continue?","Load terminal marks",MessageBoxButtons.YesNo,MessageBoxIcon.Question) != DialogResult.Yes) return;
                    StopPicking(); page=activePage; plan.Terminals.Clear(); plan.Routes.Clear(); plan.Modules=restored.Modules; plan.Bank=restored.Bank; plan.Ssc=restored.Ssc;
                    foreach(var entry in restored.Terminals) plan.Terminals.Add(entry.Key,entry.Value);
                    foreach(var entry in restored.Routes) plan.Routes.Add(entry.Key,new List<Point>(entry.Value));
                    prompts.Clear(); prompts.AddRange(MarkPersistence.Steps(plan.Modules)); count.Value=plan.Modules; bank.Value=plan.Bank; ssc.Value=plan.Ssc; next=restoredCount;
                    bool complete=next==prompts.Count; mark.Enabled=!complete; undo.Enabled=next>0; saveMarks.Enabled=true; draw.Enabled=complete;
#if EXPERIMENTAL_MOUSE_PICKING
                    pick.Enabled=!complete;
#else
                    pick.Enabled=false;
#endif
                    if(complete) { PopulateRoutes(); status.Text="Saved terminals and routes loaded. Verify positions and review routes before drawing."; }
                    else { DisableRoutes(); ShowPrompt(); }
                }
            } catch(Exception ex) { status.Text="Could not load terminal marks: "+ex.Message; }
        }
        private void Record() {
            try {
                if (picking) throw new InvalidOperationException("Stop direct clicking before selecting a marker.");
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                dynamic selection=app.ActiveWindow.Selection;
                if ((int)selection.Count != 1) throw new InvalidOperationException("Select exactly one terminal marker shape in Visio.");
                dynamic shape=selection[1];
                double x=shape.CellsU["PinX"].ResultIU; double y=shape.CellsU["PinY"].ResultIU;
                plan.Set(prompts[next],x,y); next++; undo.Enabled=true;
                if (next == prompts.Count) { mark.Enabled=false; pick.Enabled=false; draw.Enabled=true; PopulateRoutes(); status.Text="All terminal positions recorded. Add route waypoints if needed, then draw a draft for review."; }
                else ShowPrompt();
            } catch (Exception ex) { status.Text="Could not record: "+ex.Message+"\nSelect one marker on the original page and try again."; }
        }
        private void DisableRoutes() { routeChoice.Items.Clear(); routeChoice.Enabled=false; addWaypoint.Enabled=false; removeWaypoint.Enabled=false; routeStatus.Text="Mark all terminals before defining routes."; }
        private void PopulateRoutes() {
            routeChoice.Items.Clear();
            foreach(var segment in plan.Build()) routeChoice.Items.Add(new RouteOption { From=segment.From, To=segment.To, Network=segment.Network });
            routeChoice.Enabled=true; addWaypoint.Enabled=true; if(routeChoice.Items.Count>0) routeChoice.SelectedIndex=0; ShowRoute();
        }
        private void ShowRoute() {
            var option=routeChoice.SelectedItem as RouteOption; List<Point> points;
            int n=option!=null && plan.Routes.TryGetValue(DraftPlan.RouteKey(option.From,option.To),out points) ? points.Count : 0;
            removeWaypoint.Enabled=routeChoice.Enabled && n>0;
            routeStatus.Text=n==0 ? "No waypoints: a straight draft line will be drawn." : n+" waypoint(s), in selected order. Review the route and bend requirements.";
        }
        private void AddWaypoint() {
            try {
                CheckChainInputs(); if(page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                var option=routeChoice.SelectedItem as RouteOption; if(option==null) throw new InvalidOperationException("Choose a connection first.");
                dynamic selection=app.ActiveWindow.Selection; if((int)selection.Count!=1) throw new InvalidOperationException("Select one top-level route marker shape.");
                dynamic shape=selection[1]; var point=new Point((double)shape.CellsU["PinX"].ResultIU,(double)shape.CellsU["PinY"].ResultIU);
                List<Point> current; var points=plan.Routes.TryGetValue(DraftPlan.RouteKey(option.From,option.To),out current) ? new List<Point>(current) : new List<Point>();
                points.Add(point); plan.SetRoute(option.From,option.To,points); ShowRoute();
            } catch(Exception ex) { routeStatus.Text="Could not add waypoint: "+ex.Message; }
        }
        private void RemoveWaypoint() {
            try {
                var option=routeChoice.SelectedItem as RouteOption; List<Point> current;
                if(option==null || !plan.Routes.TryGetValue(DraftPlan.RouteKey(option.From,option.To),out current) || current.Count==0) return;
                var points=new List<Point>(current); points.RemoveAt(points.Count-1); plan.SetRoute(option.From,option.To,points); ShowRoute();
            } catch(Exception ex) { routeStatus.Text="Could not remove waypoint: "+ex.Message; }
        }
        private void Draw() {
            try {
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                CheckChainInputs();
                var proposed=plan.Build();
                var existing=DraftReview.ReadExisting(page);
                if (DraftReview.HasChain(existing,plan.Bank,plan.Ssc)) throw new InvalidOperationException("This page already has a tagged draft for Bank "+plan.Bank+", SSC "+plan.Ssc+". Review and remove the earlier draft before drawing a replacement.");
                var crossings=DraftReview.FindCrossings(proposed);
                crossings.AddRange(DraftReview.FindBetween(proposed,existing.Segments));
                if (crossings.Count > 0 || existing.Unreadable > 0) {
                    var lines=new List<string>();
                    for(int i=0;i<Math.Min(3,crossings.Count);i++) {
                        var c=crossings[i]; lines.Add(c.First.From+" → "+c.First.To+" / "+c.Second.From+" → "+c.Second.To);
                    }
                    string warning=crossings.Count+" possible crossing or overlap(s) among proposed paths and tagged draft wires:\n"+String.Join("\n",lines.ToArray())+(existing.Unreadable > 0 ? "\n"+existing.Unreadable+" tagged draft shape(s) could not be inspected." : "")+"\n\nThis is a 2D visual check. It does not inspect untagged wires, prior routed paths, curves or clearance. Generate the draft for review anyway?";
                    if (MessageBox.Show(this,warning,"Review draft crossings",MessageBoxButtons.YesNo,MessageBoxIcon.Warning) != DialogResult.Yes) { status.Text="Draft not drawn. Review the terminal marks and planned routes."; return; }
                }
                int n=DraftRenderer.Draw(app,page,plan); draw.Enabled=false; undo.Enabled=false; routeChoice.Enabled=false; addWaypoint.Enabled=false; removeWaypoint.Enabled=false;
                status.Text=n+" draft wire shapes added. "+crossings.Count+" possible crossing(s). Review routes, endpoints, harnesses and approvals. Use Visio Undo to remove this draft.";
            } catch (Exception ex) { status.Text="No complete draft was added: "+ex.Message; }
        }
    }
}
